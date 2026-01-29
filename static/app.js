const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

function parseNumber(value, fallback = 0) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseInteger(value, fallback = 0) {
  const num = parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

function monthlyPayment(principal, annualRate, years) {
  if (principal <= 0 || years <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  const periods = years * 12;
  if (monthlyRate === 0) {
    return principal / periods;
  }
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -periods));
}

function computeResaleValueForCycle(purchasePrice, residualPct, residualValue, priceInflationRate, cycleIndex) {
  if (residualPct > 0) {
    return (purchasePrice * residualPct) / 100;
  }
  if (residualValue > 0) {
    const factor = Math.pow(1 + priceInflationRate / 100, cycleIndex);
    return residualValue * factor;
  }
  return 0;
}

function simulateScenario(input, projectionYears, inflationRate, discountRate, replacementCycleYears) {
  const cycleLength = Math.max(1, replacementCycleYears);
  const priceInflation = input.priceInflationRate;
  const annualRunningBase = input.annualInsurance + input.annualMaintenance + input.annualOther;
  const downRatio = input.cashPurchase
    ? 1
    : input.purchasePrice > 0
    ? Math.min(1, input.downPayment / input.purchasePrice)
    : 0;

  const saleMarkers = Array(projectionYears).fill(null);
  const buyMarkers = Array(projectionYears).fill(null);
  const saleSummaries = [];
  const buySummaries = [];
  const spendSeries = [];
  const valueSeries = [];
  const netSeries = [];
  const annualBreakdown = [];

  let cumulativeCost = 0;
  let grossCumulative = 0;
  let totalRunningCosts = 0;
  let totalLoanPayments = 0;
  let totalDownPayments = 0;
  let totalResaleProceeds = 0;
  let discountedTotal = discountRate > 0 ? 0 : null;

  const startCycle = (cycleIndex, startYear) => {
    const priceFactor = Math.pow(1 + priceInflation / 100, cycleIndex);
    const purchasePrice = input.purchasePrice * priceFactor;
    const downPayment = input.cashPurchase ? purchasePrice : downRatio * purchasePrice;
    const principal = input.cashPurchase ? 0 : Math.max(purchasePrice - downPayment, 0);
    const payment = input.cashPurchase
      ? 0
      : monthlyPayment(principal, input.annualInterestRate, input.loanTermYears);
    const endYear = Math.min(startYear + cycleLength - 1, projectionYears);
    const resaleValue = computeResaleValueForCycle(
      purchasePrice,
      input.residualPct,
      input.residualValue,
      priceInflation,
      cycleIndex,
    );
    const yearsInCycle = endYear - startYear + 1;
    const valueStep = yearsInCycle > 0 ? (purchasePrice - resaleValue) / yearsInCycle : 0;
    return {
      startYear,
      endYear,
      purchasePrice,
      downPayment,
      payment,
      outstandingLoanYears: input.cashPurchase ? 0 : input.loanTermYears,
      resaleValue,
      valueStep,
    };
  };

  let cycleIndex = 0;
  let cycle = startCycle(cycleIndex, 1);
  let firstCyclePayment = cycle.payment;

  for (let year = 1; year <= projectionYears; year += 1) {
    const components = { downPayment: 0, loan: 0, running: 0, sale: 0 };
    if (year === cycle.startYear) {
      totalDownPayments += cycle.downPayment;
      buyMarkers[year - 1] = cycle.purchasePrice;
      buySummaries.push({ year, value: cycle.purchasePrice });
      components.downPayment += cycle.downPayment;
    }

    if (!input.cashPurchase && cycle.outstandingLoanYears > 0) {
      const loanPayment = cycle.payment * 12;
      components.loan += loanPayment;
      totalLoanPayments += loanPayment;
      cycle.outstandingLoanYears -= 1;
    }

    const inflationFactor = Math.pow(1 + inflationRate / 100, year - 1);
    const runningThisYear = annualRunningBase * inflationFactor;
    components.running += runningThisYear;
    totalRunningCosts += runningThisYear;

    const elapsedYears = year - cycle.startYear;
    const baseValue = cycle.purchasePrice - cycle.valueStep * elapsedYears;
    let displayValue = Math.max(baseValue, cycle.resaleValue);
    let assetValue = displayValue;
    let saleValue = 0;

    if (year === cycle.endYear) {
      saleValue = cycle.resaleValue;
      components.sale -= saleValue;
      totalResaleProceeds += saleValue;
      saleMarkers[year - 1] = saleValue;
      saleSummaries.push({ year, value: saleValue });
      displayValue = saleValue;
      assetValue = 0;
    }

    const yearCostBeforeSale =
      components.downPayment + components.loan + components.running + components.sale;

    cumulativeCost += yearCostBeforeSale;
    const grossYearCost = yearCostBeforeSale + saleValue;
    grossCumulative += grossYearCost;

    spendSeries.push(Number(cumulativeCost.toFixed(2)));
    valueSeries.push(Number(displayValue.toFixed(2)));
    netSeries.push(Number((grossCumulative - assetValue).toFixed(2)));
    annualBreakdown.push({
      year,
      downPayment: Number(components.downPayment.toFixed(2)),
      loan: Number(components.loan.toFixed(2)),
      running: Number(components.running.toFixed(2)),
      sale: Number(components.sale.toFixed(2)),
    });

    if (discountedTotal !== null) {
      const discountFactor = Math.pow(1 + discountRate / 100, year - 1);
      discountedTotal += yearCostBeforeSale / discountFactor;
    }

    if (year === cycle.endYear && year < projectionYears) {
      cycleIndex += 1;
      cycle = startCycle(cycleIndex, year + 1);
    }
  }

  const totalCost = totalDownPayments + totalLoanPayments + totalRunningCosts - totalResaleProceeds;
  const resaleValue = saleSummaries.length ? saleSummaries[saleSummaries.length - 1].value : 0;

  return {
    monthlyPayment: firstCyclePayment,
    totalLoanPayments,
    totalRunningCosts,
    resaleValue,
    totalCost,
    averageAnnualCost: projectionYears > 0 ? totalCost / projectionYears : 0,
    spendSeries,
    valueSeries,
    netSeries,
    saleMarkers,
    saleSummaries,
    buyMarkers,
    buySummaries,
    discountedTotal: discountedTotal !== null ? discountedTotal : null,
    annualBreakdown,
  };
}

function formatCurrency(value) {
  return currencyFormatter.format(value || 0);
}

function formatSaleSummary(label, items) {
  if (!items.length) {
    return `${label}: none within this horizon.`;
  }
  const parts = items.map((item) => `Year ${item.year} ${formatCurrency(item.value)}`);
  return `${label}: ${parts.join(', ')}.`;
}

function updateResults(resultSection, newResult, oldResult, comparisonMessage, discountRate, chart) {
  const newNet = newResult.netSeries.length ? newResult.netSeries[newResult.netSeries.length - 1] : 0;
  const oldNet = oldResult.netSeries.length ? oldResult.netSeries[oldResult.netSeries.length - 1] : 0;
  const ids = {
    'new-monthly-payment': newResult.monthlyPayment,
    'old-monthly-payment': oldResult.monthlyPayment,
    'new-total-loan': newResult.totalLoanPayments,
    'old-total-loan': oldResult.totalLoanPayments,
    'new-running': newResult.totalRunningCosts,
    'old-running': oldResult.totalRunningCosts,
    'new-resale': newResult.resaleValue,
    'old-resale': oldResult.resaleValue,
    'new-total': newResult.totalCost,
    'old-total': oldResult.totalCost,
    'new-average': newResult.averageAnnualCost,
    'old-average': oldResult.averageAnnualCost,
    'new-net': newNet,
    'old-net': oldNet,
  };

  Object.entries(ids).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = formatCurrency(value);
    }
  });

  const discountRow = document.getElementById('discount-row');
  if (discountRate > 0) {
    discountRow.removeAttribute('hidden');
    document.getElementById('new-discount').textContent = formatCurrency(newResult.discountedTotal);
    document.getElementById('old-discount').textContent = formatCurrency(oldResult.discountedTotal);
  } else {
    discountRow.setAttribute('hidden', 'true');
  }

  const diff = newResult.totalCost - oldResult.totalCost;
  const years = newResult.spendSeries.length;
  if (Math.abs(diff) < 0.01) {
    comparisonMessage.textContent = `Both options cost about the same over ${years} years.`;
  } else if (diff > 0) {
    comparisonMessage.textContent = `Old car is cheaper by ${formatCurrency(diff)} over ${years} years.`;
  } else {
    comparisonMessage.textContent = `New car is cheaper by ${formatCurrency(Math.abs(diff))} over ${years} years.`;
  }

  resultSection.removeAttribute('hidden');

  const saleSummaryNew = document.getElementById('new-sale-summary');
  const saleSummaryOld = document.getElementById('old-sale-summary');
  if (saleSummaryNew) {
    saleSummaryNew.innerHTML = `${formatSaleSummary('Buy New', newResult.buySummaries)}<br>${formatSaleSummary('Sell New', newResult.saleSummaries)}`;
  }
  if (saleSummaryOld) {
    saleSummaryOld.innerHTML = `${formatSaleSummary('Buy Old', oldResult.buySummaries)}<br>${formatSaleSummary('Sell Old', oldResult.saleSummaries)}`;
  }

  const chartConfig = {
    type: 'line',
    data: {
      labels: newResult.spendSeries.map((_, idx) => idx + 1),
      datasets: [
        {
          label: 'New car spend',
          data: newResult.spendSeries,
          borderColor: '#1e3a8a',
          backgroundColor: 'rgba(30, 58, 138, 0.08)',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
        },
        {
          label: 'Old car spend',
          data: oldResult.spendSeries,
          borderColor: '#a16207',
          backgroundColor: 'rgba(161, 98, 7, 0.08)',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
        },
        {
          label: 'New car value',
          data: newResult.valueSeries,
          borderColor: '#1e3a8a',
          borderDash: [6, 4],
          backgroundColor: 'rgba(30, 58, 138, 0)',
          borderWidth: 2,
          tension: 0.3,
          fill: false,
        },
        {
          label: 'Old car value',
          data: oldResult.valueSeries,
          borderColor: '#a16207',
          borderDash: [6, 4],
          backgroundColor: 'rgba(161, 98, 7, 0)',
          borderWidth: 2,
          tension: 0.3,
          fill: false,
        },
        {
          label: 'Buy New',
          data: newResult.buyMarkers,
          borderColor: '#1e3a8a',
          backgroundColor: '#1e3a8a',
          borderWidth: 0,
          pointRadius: 6,
          pointHoverRadius: 7,
          showLine: false,
        },
        {
          label: 'Sell New',
          data: newResult.saleMarkers,
          borderColor: '#1e3a8a',
          backgroundColor: '#1e3a8a',
          borderWidth: 0,
          pointRadius: 6,
          pointHoverRadius: 7,
          showLine: false,
        },
        {
          label: 'Buy Old',
          data: oldResult.buyMarkers,
          borderColor: '#a16207',
          backgroundColor: '#a16207',
          borderWidth: 0,
          pointRadius: 6,
          pointHoverRadius: 7,
          showLine: false,
        },
        {
          label: 'Sell Old',
          data: oldResult.saleMarkers,
          borderColor: '#a16207',
          backgroundColor: '#a16207',
          borderWidth: 0,
          pointRadius: 6,
          pointHoverRadius: 7,
          showLine: false,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: {
          title: { display: true, text: 'Year' },
        },
        y: {
          title: { display: true, text: 'Cumulative cost (EUR)' },
          ticks: {
            callback: (value) => numberFormatter.format(value),
          },
        },
      },
    },
  };

  if (chart.instance) {
    chart.instance.data = chartConfig.data;
    chart.instance.options = chartConfig.options;
    chart.instance.update();
  } else {
    const ctx = document.getElementById('costChart');
    chart.instance = new Chart(ctx, chartConfig);
  }

  const breakdownLabels = newResult.annualBreakdown.map((entry) => `Year ${entry.year}`);
  const makeSeries = (breakdown, key) => breakdown.map((entry) => entry[key]);
  const breakdownConfig = {
    type: 'bar',
    data: {
      labels: breakdownLabels,
      datasets: [
        { label: 'Down payment (New)', data: makeSeries(newResult.annualBreakdown, 'downPayment'), backgroundColor: '#f59e0b', stack: 'new' },
        { label: 'Loan (New)', data: makeSeries(newResult.annualBreakdown, 'loan'), backgroundColor: '#2563eb', stack: 'new' },
        { label: 'Running (New)', data: makeSeries(newResult.annualBreakdown, 'running'), backgroundColor: '#22c55e', stack: 'new' },
        { label: 'Sale (New)', data: makeSeries(newResult.annualBreakdown, 'sale'), backgroundColor: '#f87171', stack: 'new' },
        { label: 'Down payment (Old)', data: makeSeries(oldResult.annualBreakdown, 'downPayment'), backgroundColor: '#fcd34d', stack: 'old' },
        { label: 'Loan (Old)', data: makeSeries(oldResult.annualBreakdown, 'loan'), backgroundColor: '#93c5fd', stack: 'old' },
        { label: 'Running (Old)', data: makeSeries(oldResult.annualBreakdown, 'running'), backgroundColor: '#86efac', stack: 'old' },
        { label: 'Sale (Old)', data: makeSeries(oldResult.annualBreakdown, 'sale'), backgroundColor: '#fda4af', stack: 'old' },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          ticks: { callback: (value) => numberFormatter.format(value) },
          title: { display: true, text: 'Cost per year (EUR)' },
        },
      },
    },
  };

  if (chart.breakdown) {
    chart.breakdown.data = breakdownConfig.data;
    chart.breakdown.options = breakdownConfig.options;
    chart.breakdown.update();
  } else {
    const ctx = document.getElementById('costBreakdownChart');
    chart.breakdown = new Chart(ctx, breakdownConfig);
  }
}

function handleCashToggle() {
  const checkbox = document.querySelector('input[name="old_cash_purchase"]');
  const loanInputs = document.querySelectorAll('[data-old-loan]');
  if (!checkbox) return;
  const updateState = () => {
    const disabled = checkbox.checked;
    loanInputs.forEach((input) => {
      input.disabled = disabled;
      const label = input.closest('label');
      if (!label) return;
      if (disabled) {
        label.classList.add('is-disabled');
      } else {
        label.classList.remove('is-disabled');
      }
    });
  };
  checkbox.addEventListener('change', updateState);
  updateState();
}

function collectScenario(prefix, formData) {
  return {
    purchasePrice: parseNumber(formData.get(`${prefix}_purchase_price`)),
    priceInflationRate: parseNumber(formData.get(`${prefix}_price_inflation`)),
    downPayment: parseNumber(formData.get(`${prefix}_down_payment`)),
    loanTermYears: parseInteger(formData.get(`${prefix}_loan_term_years`)),
    annualInterestRate: parseNumber(formData.get(`${prefix}_annual_interest_rate`)),
    residualPct: parseNumber(formData.get(`${prefix}_residual_pct`)),
    residualValue: parseNumber(formData.get(`${prefix}_residual_value`)),
    annualInsurance: parseNumber(formData.get(`${prefix}_annual_insurance`)),
    annualMaintenance: parseNumber(formData.get(`${prefix}_annual_maintenance`)),
    annualOther: parseNumber(formData.get(`${prefix}_annual_other`)),
    cashPurchase: prefix === 'old' ? formData.has('old_cash_purchase') : false,
  };
}

function initApp() {
  const form = document.getElementById('cost-form');
  const resultSection = document.getElementById('results');
  const comparisonMessage = document.getElementById('comparison-message');
  const chart = { instance: null, breakdown: null };

  if (!form) return;
  handleCashToggle();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const projectionYears = parseInteger(formData.get('projection_years'), 5);
    const inflationRate = parseNumber(formData.get('inflation_rate'), 3.5);
    const discountRate = parseNumber(formData.get('discount_rate'), 0);
    const replacementCycleYears = parseInteger(formData.get('replacement_cycle_years'), 5);

    const newScenario = collectScenario('new', formData);
    const oldScenario = collectScenario('old', formData);

    const newResult = simulateScenario(
      newScenario,
      projectionYears,
      inflationRate,
      discountRate,
      replacementCycleYears,
    );
    const oldResult = simulateScenario(
      oldScenario,
      projectionYears,
      inflationRate,
      discountRate,
      replacementCycleYears,
    );

    updateResults(resultSection, newResult, oldResult, comparisonMessage, discountRate, chart);
  });

  form.dispatchEvent(new Event('submit'));
}

document.addEventListener('DOMContentLoaded', initApp);

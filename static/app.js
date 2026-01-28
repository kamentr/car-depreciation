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

function computeRunningCosts(annual, years, inflationRate) {
  let total = 0;
  for (let year = 1; year <= years; year += 1) {
    const inflationFactor = Math.pow(1 + inflationRate / 100, year - 1);
    total += annual * inflationFactor;
  }
  return total;
}

function computeResaleValue(purchasePrice, residualPct, residualValue) {
  if (residualPct > 0) {
    return (purchasePrice * residualPct) / 100;
  }
  return Math.max(residualValue, 0);
}

function computeCumulativeCosts(options) {
  const {
    purchasePrice,
    downPayment,
    loanTermYears,
    annualInterestRate,
    annualRunning,
    inflationRate,
    resaleValue,
    projectionYears,
    cashPurchase,
  } = options;

  const effectiveDown = cashPurchase ? purchasePrice : downPayment;
  const payment = cashPurchase
    ? 0
    : monthlyPayment(purchasePrice - effectiveDown, annualInterestRate, loanTermYears);

  const spendSeries = [];
  const netSeries = [];
  const valueSeries = [];
  let runningTotal = 0;
  let grossTotal = 0;
  const valueStep = projectionYears > 0 ? (purchasePrice - resaleValue) / projectionYears : 0;
  for (let year = 1; year <= projectionYears; year += 1) {
    let yearCost = 0;
    if (year === 1) {
      yearCost += effectiveDown;
    }
    if (!cashPurchase && year <= loanTermYears) {
      yearCost += payment * 12;
    }
    const inflationFactor = Math.pow(1 + inflationRate / 100, year - 1);
    yearCost += annualRunning * inflationFactor;
    grossTotal += yearCost;

    let displayCost = yearCost;
    if (year === projectionYears) {
      displayCost -= resaleValue;
    }
    runningTotal += displayCost;
    spendSeries.push(Number(runningTotal.toFixed(2)));

    const remainingValue = purchasePrice - valueStep * year;
    const adjustedValue = projectionYears > 0 ? Math.max(remainingValue, resaleValue) : resaleValue;
    netSeries.push(Number((grossTotal - adjustedValue).toFixed(2)));
    valueSeries.push(Number(adjustedValue.toFixed(2)));
  }
  return { spendSeries, netSeries, valueSeries };
}

function computeDiscountedTotalCost(options) {
  const {
    purchasePrice,
    downPayment,
    loanTermYears,
    annualInterestRate,
    annualRunning,
    inflationRate,
    resaleValue,
    projectionYears,
    cashPurchase,
    discountRate,
  } = options;

  if (projectionYears <= 0 || discountRate <= 0) {
    return 0;
  }

  const effectiveDown = cashPurchase ? purchasePrice : downPayment;
  const payment = cashPurchase
    ? 0
    : monthlyPayment(purchasePrice - effectiveDown, annualInterestRate, loanTermYears);

  let total = effectiveDown;
  for (let year = 1; year <= projectionYears; year += 1) {
    let yearPayment = 0;
    if (!cashPurchase && year <= loanTermYears) {
      yearPayment += payment * 12;
    }
    const inflationFactor = Math.pow(1 + inflationRate / 100, year - 1);
    yearPayment += annualRunning * inflationFactor;
    const discountFactor = Math.pow(1 + discountRate / 100, year - 1);
    total += yearPayment / discountFactor;
  }

  total -= resaleValue / Math.pow(1 + discountRate / 100, projectionYears - 1);
  return total;
}

function calculateScenario(input, projectionYears, inflationRate, discountRate) {
  const effectiveDown = input.cashPurchase ? input.purchasePrice : input.downPayment;
  const principal = input.cashPurchase
    ? 0
    : Math.max(input.purchasePrice - effectiveDown, 0);
  const payment = input.cashPurchase
    ? 0
    : monthlyPayment(principal, input.annualInterestRate, input.loanTermYears);
  const totalLoanPayments = input.cashPurchase ? 0 : payment * input.loanTermYears * 12;

  const annualRunning = input.annualInsurance + input.annualMaintenance + input.annualOther;
  const totalRunningCosts = computeRunningCosts(
    annualRunning,
    projectionYears,
    inflationRate,
  );
  const resaleValue = computeResaleValue(
    input.purchasePrice,
    input.residualPct,
    input.residualValue,
  );

  const totalCost = effectiveDown + totalLoanPayments + totalRunningCosts - resaleValue;
  const averageAnnual = projectionYears > 0 ? totalCost / projectionYears : 0;
  const { spendSeries, netSeries, valueSeries } = computeCumulativeCosts({
    purchasePrice: input.purchasePrice,
    downPayment: input.downPayment,
    loanTermYears: input.loanTermYears,
    annualInterestRate: input.annualInterestRate,
    annualRunning,
    inflationRate,
    resaleValue,
    projectionYears,
    cashPurchase: input.cashPurchase,
  });

  let discountedTotal = null;
  if (discountRate > 0) {
    discountedTotal = computeDiscountedTotalCost({
      purchasePrice: input.purchasePrice,
      downPayment: input.downPayment,
      loanTermYears: input.loanTermYears,
      annualInterestRate: input.annualInterestRate,
      annualRunning,
      inflationRate,
      resaleValue,
      projectionYears,
      cashPurchase: input.cashPurchase,
      discountRate,
    });
  }

  return {
    monthlyPayment: payment,
    totalLoanPayments,
    totalRunningCosts,
    resaleValue,
    totalCost,
    averageAnnual,
    spendSeries,
    netSeries,
    valueSeries,
    discountedTotal,
  };
}

function formatCurrency(value) {
  return currencyFormatter.format(value || 0);
}

function updateResults(resultSection, newResult, oldResult, comparisonMessage, discountRate, chart) {
  const newNet = newResult.netSeries.length
    ? newResult.netSeries[newResult.netSeries.length - 1]
    : 0;
  const oldNet = oldResult.netSeries.length
    ? oldResult.netSeries[oldResult.netSeries.length - 1]
    : 0;
  const saleYear = newResult.spendSeries.length;

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
    'new-average': newResult.averageAnnual,
    'old-average': oldResult.averageAnnual,
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
    saleSummaryNew.textContent = `New car sale: ${formatCurrency(newResult.resaleValue)} received in year ${saleYear}.`;
  }
  if (saleSummaryOld) {
    saleSummaryOld.textContent = `Old car sale: ${formatCurrency(oldResult.resaleValue)} received in year ${saleYear}.`;
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
          backgroundColor: 'rgba(30, 58, 138, 0.0)',
          borderWidth: 2,
          tension: 0.3,
          fill: false,
        },
        {
          label: 'Old car value',
          data: oldResult.valueSeries,
          borderColor: '#a16207',
          borderDash: [6, 4],
          backgroundColor: 'rgba(161, 98, 7, 0.0)',
          borderWidth: 2,
          tension: 0.3,
          fill: false,
        },
        {
          label: 'New car sale event',
          data: newResult.valueSeries.map((value, idx, arr) => (idx === arr.length - 1 ? value : null)),
          borderColor: '#1e3a8a',
          backgroundColor: '#1e3a8a',
          borderWidth: 0,
          pointRadius: 6,
          pointHoverRadius: 7,
          showLine: false,
        },
        {
          label: 'Old car sale event',
          data: oldResult.valueSeries.map((value, idx, arr) => (idx === arr.length - 1 ? value : null)),
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
  const chart = { instance: null };

  if (!form) return;
  handleCashToggle();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const projectionYears = parseInteger(formData.get('projection_years'), 5);
    const inflationRate = parseNumber(formData.get('inflation_rate'), 3.5);
    const discountRate = parseNumber(formData.get('discount_rate'), 0);

    const newScenario = collectScenario('new', formData);
    const oldScenario = collectScenario('old', formData);

    const newResult = calculateScenario(newScenario, projectionYears, inflationRate, discountRate);
    const oldResult = calculateScenario(oldScenario, projectionYears, inflationRate, discountRate);

    updateResults(resultSection, newResult, oldResult, comparisonMessage, discountRate, chart);
  });

  form.dispatchEvent(new Event('submit'));
}

document.addEventListener('DOMContentLoaded', initApp);

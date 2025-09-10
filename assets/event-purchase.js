var Shopify = Shopify || {};
// ---------------------------------------------------------------------------
// Money format handler
// ---------------------------------------------------------------------------
if (!window.eventPurchaseMoneyFormat) throw new Error('no money format for event purchase');
Shopify.money_format = window.eventPurchaseMoneyFormat;
Shopify.formatMoney = function (cents, format) {
  if (typeof cents == 'string') {
    cents = cents.replace('.', '');
  }
  var value = '';
  var placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
  var formatString = (format || this.money_format);

  function defaultOption(opt, def) {
    return (typeof opt == 'undefined' ? def : opt);
  }

  function formatWithDelimiters(number, precision, thousands, decimal) {
    precision = defaultOption(precision, 2);
    thousands = defaultOption(thousands, ',');
    decimal = defaultOption(decimal, '.');

    if (isNaN(number) || number == null) {
      return 0;
    }

    number = (number / 100.0).toFixed(precision);

    var parts = number.split('.'),
      dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands),
      cents = parts[1] ? (decimal + parts[1]) : '';

    return dollars + cents;
  }

  switch (formatString.match(placeholderRegex)[1]) {
    case 'amount':
      value = formatWithDelimiters(cents, 2);
      break;
    case 'amount_no_decimals':
      value = formatWithDelimiters(cents, 0);
      break;
    case 'amount_with_comma_separator':
      value = formatWithDelimiters(cents, 2, '.', ',');
      break;
    case 'amount_no_decimals_with_comma_separator':
      value = formatWithDelimiters(cents, 0, '.', ',');
      break;
  }

  return formatString.replace(placeholderRegex, value);
};

const productSection = document.querySelector('[data-section="event-purchase"]');
if (!productSection) throw new Error('No event product section');

const productJsonElement = productSection.querySelector('#evt-product-json');
if (!productJsonElement) throw new Error('No product JSON element');

const product = JSON.parse(productJsonElement.textContent);
const form = productSection.closest('form');
const priceEl = productSection.querySelector('[data-price]');
const checkoutButton = productSection.querySelector('[data-checkout]');
const radios = productSection.querySelectorAll('.evt-radio input');

// Option names
const CODE_NAME = 'Код';
const DATE_NAME = 'Дня проведення змагання';
const TIME_NAME = 'Час проведення';

function getFieldsetByName(name) {
  return productSection.querySelector(`.evt-fieldset[data-option-name="${name}"]`);
}

const codeFieldset = getFieldsetByName(CODE_NAME);
const dateFieldset = getFieldsetByName(DATE_NAME);
const timeFieldset = getFieldsetByName(TIME_NAME);

if (!(codeFieldset && dateFieldset && timeFieldset)) {
  throw new Error('Missing one of the required option fieldsets');
}

// --- Build dynamic map: code -> date -> available times ---
const timeByScenario = {};

product.variants.forEach(v => {
  const inStock = v.available && (v.inventory_quantity === undefined || v.inventory_quantity > 0);
  if (!inStock) return;

  const [code, date, time] = v.options;
  if (!timeByScenario[code]) timeByScenario[code] = {};
  if (!timeByScenario[code][date]) timeByScenario[code][date] = [];
  if (!timeByScenario[code][date].includes(time)) {
    timeByScenario[code][date].push(time);
  }
});

// --- Enforce option constraints ---
function enforceConstraints() {
  const code = codeFieldset.querySelector('input:checked')?.value;
  const validDates = code ? Object.keys(timeByScenario[code] || {}) : [];

  // Enable/disable dates
  dateFieldset.querySelectorAll('input').forEach(radio => {
    const ok = validDates.includes(radio.value);
    radio.disabled = !ok;
    if (!ok && radio.checked) radio.checked = false;
  });

  // Auto-select first valid date if none
  let date = dateFieldset.querySelector('input:checked')?.value;
  if (validDates.length && !date) {
    const firstValid = dateFieldset.querySelector(`input[value="${validDates[0]}"]`);
    if (firstValid) {
      firstValid.checked = true;
      date = firstValid.value;
    }
  }

  // Enable/disable times based on selected code/date
  const allowedTimes = code && date ? (timeByScenario[code][date] || []) : [];
  timeFieldset.querySelectorAll('input').forEach(radio => {
    const ok = allowedTimes.includes(radio.value);
    radio.disabled = !ok;
    if (!ok && radio.checked) radio.checked = false;
  });

  // Auto-select first valid time if none
  if (allowedTimes.length && !timeFieldset.querySelector('input:checked')) {
    const firstValid = timeFieldset.querySelector(`input[value="${allowedTimes[0]}"]`);
    if (firstValid) firstValid.checked = true;
  }

  // Disable checkout button if no available variant
  const selectedOptions = getSelectedOptions();
  const variant = findVariantByOptions(selectedOptions);
  checkoutButton.disabled = !variant?.available;
}

function getSelectedOptions() {
  return product.options.map((opt) => {
    const selected = productSection.querySelector(
      `.evt-fieldset[data-option-name="${opt}"] input:checked`
    );
    return selected ? selected.value : null;
  });
}

function findVariantByOptions(optionsArray) {
  return product.variants.find(v =>
    v.options.every((opt, i) => String(opt) === String(optionsArray[i]))
  ) || null;
}

function updateVariant() {
  enforceConstraints();
  const values = getSelectedOptions();
  const variant = findVariantByOptions(values);
  if (variant) {
    form.querySelector('input[name="id"]').value = variant.id;
    if (priceEl) priceEl.textContent = `${Shopify.formatMoney(variant.price, Shopify.money_format)} ${Shopify.currency.active}`;
    checkoutButton.disabled = !variant.available;
  } else {
    checkoutButton.disabled = true;
  }
}

radios.forEach(r => r.addEventListener('change', updateVariant));
updateVariant();

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (form.reportValidity && !form.reportValidity()) return;

  const variantId = form.querySelector('input[name="id"]').value;
  const props = {};
  form.querySelectorAll('[name^="properties["]').forEach(el => {
    const key = el.name.match(/^properties\[(.*)\]$/)[1];
    if (el.value) props[key] = el.value;
  });

  try {
    await fetch('/cart/add.js', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: JSON.stringify({id: Number(variantId), quantity: 1, properties: props})
    });

    window.location.href = '/checkout';
  } catch (err) {
    console.error(err);
    alert('Error adding to cart. Please try again later.');
  }
});

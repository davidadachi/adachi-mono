function croppedAddress(address) {
  if (!address) {
    return '';
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function displayNumber(val, decimals) {
  if (val === '') {
    return '';
  }
  const valFloat = parseFloat(val);
  if (!decimals && Math.floor(valFloat) === valFloat) {
    decimals = 0;
  } else if (!decimals) {
    decimals = valFloat.toString().split('.')[1].length || 0;
  }

  return valFloat.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function displayDollars(val) {
  const valDisplay = isNaN(val) ? ' -' : displayNumber(val, 2);
  return '$' + valDisplay;
}

function roundUpPenny(val) {
  return Math.ceil(val * 100) / 100;
}

function roundDownPenny(val) {
  return Math.floor(val * 100) / 100;
}

export { croppedAddress, displayNumber, displayDollars, roundUpPenny, roundDownPenny };

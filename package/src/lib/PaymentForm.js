import { v4 as uuidv4 } from 'uuid';
import { AES256HMACSHA384HEX } from './encryption';
import { convertQueryParamsToObject, getPaymentUrl } from './helper';

const submitPaymentForm = async ({
  clientCode, transUserName, transUserPassword,
  callbackUrl, authKey, authIV,
  payerName, payerEmail, payerMobile, amount,
  udf1, udf2, udf3, udf4, udf5,
  udf6, udf7, udf8, udf9, udf10,
  udf11, udf12, udf13, udf14, udf15,
  udf16, udf17, udf18, udf19, udf20,
  payerVpa, modeTransfer, byPassFlag,
  cardHolderName, pan, cardExpMonth,
  cardExpYear, cardType, cvv,
  browserDetails, bankId, channelId, clientTxnId, env
}) => {
  const txnId = clientTxnId || uuidv4().replace(/-/g, "").slice(0, 20).toUpperCase();
  const params = new URLSearchParams({
    payerName, payerEmail, payerMobile,
    clientTxnId: txnId, amount, clientCode,
    transUserName, transUserPassword,
    callbackUrl, channelId,
    udf1, udf2, udf3, udf4, udf5,
    udf6, udf7, udf8, udf9, udf10,
    udf11, udf12, udf13, udf14, udf15,
    udf16, udf17, udf18, udf19, udf20,
    payerVpa, modeTransfer, byPassFlag,
    cardHolderName, pan, cardExpMonth,
    cardExpYear, cardType, cvv,
    browserDetails, bankId
  });
  const encData = await AES256HMACSHA384HEX.encrypt(authKey, authIV, params.toString());

  if (encData) {
    const form = document.createElement('form');
    form.method = 'POST';

    form.action = getPaymentUrl(env.toLowerCase());

    const createHiddenInput = (name, value) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      return input;
    };

    form.appendChild(createHiddenInput('encData', encData));
    form.appendChild(createHiddenInput('clientCode', clientCode));

    document.body.appendChild(form);
    form.submit();
  } else {
    throw new Error("Encryption failed");
  }
};

const parsePaymentResponse = async (authKey, authIV) => {
  const encResponse = new URLSearchParams(window.location.search).get('encResponse');
  if (authKey && authIV && encResponse) {
    const data = await AES256HMACSHA384HEX.decrypt(authKey, authIV, encResponse.replaceAll(' ', '+'));
    const response = convertQueryParamsToObject(data);
    if (response) {
      return response;
    } else {
      throw new Error("Invalid response data");
    }
  }
}

export { submitPaymentForm, parsePaymentResponse };
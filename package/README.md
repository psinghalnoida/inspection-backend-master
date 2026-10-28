# 🔐 sabpaisa-pg-dev

A React component to securely integrate SabPaisa payment gateway into your web application.

## 📦 Installation

```bash
npm install sabpaisa-pg-dev
```

## 🚀 Usage

```jsx
import React from "react";
import PaymentForm from "sabpaisa-pg-dev";

const App = () => {
  const formData = {
    clientCode: "YOUR_CLIENT_CODE",
    transUserName: "YOUR_USERNAME",
    transUserPassword: "YOUR_PASSWORD",
    authKey: "YOUR_ENCRYPTION_KEY",
    authIV: "YOUR_ENCRYPTION_IV",
    callbackUrl: "https://your-site.com/callback",
    payerName: "John Doe",
    payerEmail: "john@example.com",
    payerMobile: "9876543210",
    amount: "100.00",
    channelId: "npm",
    url: "https://secure.sabpaisa.in/SabPaisa/sabPaisaInit?v=1",
    udf1: "", udf2: "", udf3: "", udf4: "", udf5: "",
    udf6: "", udf7: "", udf8: "", udf9: "", udf10: "",
    udf11: "", udf12: "", udf13: "", udf14: "", udf15: "",
    udf16: "", udf17: "", udf18: "", udf19: "", udf20: "",
    payerVpa: "", modeTransfer: "", byPassFlag: "",
    cardHolderName: "", pan: "", cardExpMonth: "",
    cardExpYear: "", cardType: "", cvv: "", browserDetails: "",
    bankId: "",
  };

  const responseHandler = (response) => {
    console.log("Payment Gateway Response:", response);
  };

  return (
    <PaymentForm
      {...formData}
      callbackFunction={responseHandler}
      env="stag"
    />
  );
};

export default App;
```

## 🧾 Props

| Prop | Type | Description |
|------|------|-------------|
| `clientCode` | `string` | Unique client code provided by SabPaisa |
| `transUserName` | `string` | Transaction username |
| `transUserPassword` | `string` | Transaction password |
| `callbackFunction` | `function` | Function called with payment response |
| `authKey` | `string` | AES encryption key |
| `authIV` | `string` | AES IV for encryption |
| `payerName`, `payerEmail`, `payerMobile` | `string` | Payer details |
| `amount` | `string` or `number` | Payment amount |
| `channelId` | `string` | e.g., "npm" |
| `url` | `string` | SabPaisa Init API URL |
| `udf1`–`udf20` | `string` | User-defined fields |
| `payerVpa` | `string` | Virtual Payment Address (for UPI) |
| `modeTransfer`, `byPassFlag`, `cardHolderName`, `pan`, `cardExpMonth`, `cardExpYear`, `cardType`, `cvv`, `browserDetails`, `bankId` | `string` | Optional parameters for card/netbanking payments |
| `env` | `string` | `"stag"` for staging, `"prod"` for production |

## ✅ Example Callback Response

```js
{
  payerName: "Name of the person who made the payment",
  amount: "Payment amount",
  paymentMode: "Payment method used (CARD, UPI, NETBANKING, etc.)",
  status: "Payment status (SUCCESS, FAILED, etc.)"
}
```
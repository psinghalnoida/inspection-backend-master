import { uatUrl, prodUrl, stagUrl } from "./envVariables";

const convertQueryParamsToObject = (queryString) => {
    const json = Object.fromEntries(new URLSearchParams(queryString));

    for (const key in json) {
        if (json[key] === "null") {
            json[key] = null;
        }
    }

    return json;
};

const getPaymentUrl = (env) => {
    const urlMap = {
        uat: uatUrl,
        stag: stagUrl,
        prod: prodUrl,
    };

    return urlMap[env] || stagUrl; // Defaults to stagUrl if env not found
};

export { convertQueryParamsToObject, getPaymentUrl };
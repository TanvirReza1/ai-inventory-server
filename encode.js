// encode.js
const fs = require("fs");
const key = fs.readFileSync(
  "./ai-model-inventory-app-firebase-adminsdk-fbsvc-926f11f7de.json",
  "utf8"
);
const base64 = Buffer.from(key).toString("base64");
console.log(base64);

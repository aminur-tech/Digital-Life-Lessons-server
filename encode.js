const fs = require('fs');
const key = fs.readFileSync('./digital-life-lessons-firebase-adminsdk-fbsvc-dfef46b976.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)
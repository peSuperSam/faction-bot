const { COOKIE_NAME, clearCookie } = require('../../src/web-session');
const { cookiesSecure } = require('../_lib/http');

module.exports = function handler(req, res) {
  res.writeHead(302, {
    Location: '/login',
    'Set-Cookie': clearCookie(COOKIE_NAME, { secure: cookiesSecure() }),
  });
  res.end();
};

/* eslint-disable no-console */

const path = require('path');
const { promisify } = require('util');

const Koa = require('koa');
const render = require('koa-ejs');
const helmet = require('helmet');
const mount = require('koa-mount');

const { Provider } = require('../lib'); // require('oidc-provider');

const Account = require('./support/account');
const configuration = require('./support/configuration');
const routes = require('./routes/koa');

const { PORT = 443, ISSUER = "https://local.algorigo.com" } = process.env;
configuration.findAccount = Account.findAccount;

const app = new Koa();

const directives = helmet.contentSecurityPolicy.getDefaultDirectives();
delete directives['form-action'];
const pHelmet = promisify(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives,
  },
}));

app.use(async (ctx, next) => {
  console.log("000:"+ctx.request.method);
  console.log("111:"+ctx.request['url']);
  await next();
});

app.use(async (ctx, next) => {
  const origSecure = ctx.req.secure;
  ctx.req.secure = ctx.request.secure;
  await pHelmet(ctx.req, ctx.res);
  ctx.req.secure = origSecure;
  return next();
});

render(app, {
  cache: false,
  viewExt: 'ejs',
  layout: '_layout',
  root: path.join(__dirname, 'views'),
});

if (process.env.NODE_ENV === 'production') {
  app.proxy = true;

  app.use(async (ctx, next) => {
    if (ctx.secure) {
      await next();
    } else if (ctx.method === 'GET' || ctx.method === 'HEAD') {
      ctx.status = 303;
      ctx.redirect(ctx.href.replace(/^http:\/\//i, 'https://'));
    } else {
      ctx.body = {
        error: 'invalid_request',
        error_description: 'do yourself a favor and only use https',
      };
      ctx.status = 400;
    }
  });
}

let server;
(async () => {
  let adapter;
  if (process.env.MONGODB_URI) {
    adapter = require('./adapters/mongodb'); // eslint-disable-line global-require
    await adapter.connect();
  }

  const provider = new Provider(ISSUER, { adapter, ...configuration });

  if (true) {
    const openid = require('openid-client'); // eslint-disable-line global-require, import/no-unresolved
    const google = await openid.Issuer.discover('https://accounts.google.com/.well-known/openid-configuration');
    const googleClient = new google.Client({
      client_id: '190468184803-5s1sbdcubpr5telou8gf9hk1f860i148.apps.googleusercontent.com',
      client_secret: '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',
      response_types: ['id_token'],
      redirect_uris: [`${ISSUER}/interaction/callback/google`],
      grant_types: ['implicit'],
    });
    provider.app.context.google = googleClient;
  }

  app.use(routes(provider).routes());
  app.use(mount(provider.app));
  server = app.listen(PORT, () => {
    console.log(`application is listening on port ${PORT}, check its /.well-known/openid-configuration`);
  });
})().catch((err) => {
  if (server && server.listening) server.close();
  console.error(err);
  process.exitCode = 1;
});

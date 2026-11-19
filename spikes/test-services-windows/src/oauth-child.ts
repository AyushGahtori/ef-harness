import { OauthMock } from "./oauth-mock.ts";

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) {
  process.stderr.write("oauth child requires a port\n");
  process.exit(1);
}
const oauth = await OauthMock.start(port);
process.stdout.write(`oauth ready ${oauth.port}\n`);
setInterval(() => undefined, 1000);

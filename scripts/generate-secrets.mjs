// Prints fresh random values for the production secrets. Never commit the output.
import { randomBytes } from "node:crypto";
console.log(`DATA_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`SETUP_TOKEN=${randomBytes(24).toString("base64url")}`);

import type { DBAdapter, DBTransactionAdapter, Where } from "better-auth/adapters";
import type { Pool } from "pg";
import { lookupUserIdByEmailHmacFromPool } from "./connection.js";

type AdapterRow = Record<string, unknown>;

export interface EmailPrivacyCodec {
  keyVersion: number;
  computeEmailHmac: (email: string) => string;
  encryptEmail: (email: string) => string;
  decryptEmail: (ciphertext: string) => string;
}

export interface EmailHashAdapterConfig {
  pool: Pool;
  codec: EmailPrivacyCodec;
}

export const betterAuthTelemetryDisabledConfig = {
  enabled: false,
} as const;

function encodeData(model: string, data: AdapterRow, codec: EmailPrivacyCodec): AdapterRow {
  if (model === "user") {
    const transformed: AdapterRow = { ...data };
    delete transformed.name;
    delete transformed.image;
    if (typeof transformed.email === "string") {
      const emailAddress = transformed.email;
      transformed.emailHash = codec.computeEmailHmac(emailAddress);
      transformed.emailCiphertext = codec.encryptEmail(emailAddress);
      transformed.keyVersion = codec.keyVersion;
      delete transformed.email;
    }
    return transformed;
  }
  if (model === "verification" && typeof data.value === "string") {
    return { ...data, value: codec.encryptEmail(data.value) };
  }
  return data;
}

function decodeRow<RowType>(model: string, row: RowType, codec: EmailPrivacyCodec): RowType {
  if (!row || typeof row !== "object") {
    return row;
  }
  const decoded: AdapterRow = { ...(row as AdapterRow) };
  if (model === "user" && typeof decoded.emailCiphertext === "string") {
    decoded.email = codec.decryptEmail(decoded.emailCiphertext);
    delete decoded.emailCiphertext;
    delete decoded.emailHash;
    delete decoded.keyVersion;
  }
  if (model === "verification" && typeof decoded.value === "string") {
    decoded.value = codec.decryptEmail(decoded.value);
  }
  if (decoded.user && typeof decoded.user === "object") {
    decoded.user = decodeRow("user", decoded.user, codec);
  }
  return decoded as RowType;
}

function extractEmailLookupValue(model: string, where: Where[]): string | undefined {
  const [condition] = where;
  if (model !== "user" || where.length !== 1 || condition?.field !== "email" || typeof condition.value !== "string") {
    return undefined;
  }
  return condition.value;
}

function wrapTransactionMethods(inner: DBTransactionAdapter, config: EmailHashAdapterConfig): DBTransactionAdapter {
  const { pool, codec } = config;
  const findOne = async (input: { model: string; where: Where[]; select?: string[] }) => {
    const emailAddress = extractEmailLookupValue(input.model, input.where);
    if (emailAddress === undefined) {
      const row = await inner.findOne<AdapterRow>(input);
      return decodeRow(input.model, row, codec);
    }
    const emailHmac = codec.computeEmailHmac(emailAddress);
    const userId = await lookupUserIdByEmailHmacFromPool(pool, emailHmac);
    if (userId === null) {
      return null;
    }
    const row = await inner.findOne<AdapterRow>({ ...input, where: [{ field: "id", value: userId }] });
    return decodeRow(input.model, row, codec);
  };

  return {
    ...inner,
    create: (async (input: { model: string; data: AdapterRow; select?: string[]; forceAllowId?: boolean }) => {
      const row = await inner.create<AdapterRow>({ ...input, data: encodeData(input.model, input.data, codec) });
      return decodeRow(input.model, row, codec);
    }) as DBAdapter["create"],
    findOne: findOne as DBAdapter["findOne"],
    findMany: (async (input: Parameters<DBAdapter["findMany"]>[0]) => {
      const rows = await inner.findMany<AdapterRow>(input);
      return rows.map((row) => decodeRow(input.model, row, codec));
    }) as DBAdapter["findMany"],
    update: (async (input: Parameters<DBAdapter["update"]>[0]) => {
      const update = encodeData(input.model, input.update, codec);
      const row = await inner.update<AdapterRow>({ ...input, update });
      return decodeRow(input.model, row, codec);
    }) as DBAdapter["update"],
    updateMany: (input) =>
      inner.updateMany({
        ...input,
        update: encodeData(input.model, input.update, codec),
      }),
  };
}

export function createEmailHashAdapter(inner: DBAdapter, config: EmailHashAdapterConfig): DBAdapter {
  return {
    ...wrapTransactionMethods(inner, config),
    transaction: (callback) => inner.transaction((transactionAdapter) => callback(wrapTransactionMethods(transactionAdapter, config))),
  };
}

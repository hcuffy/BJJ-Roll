import type { DBAdapter, DBTransactionAdapter, Where } from "better-auth/adapters";
import type { EmailProtection } from "./emailProtection.js";

type AdapterRow = Record<string, unknown>;
export type LookupUserIdByEmailHash = (emailHash: string) => Promise<string | null>;

interface ProtectionContext {
  protection: EmailProtection;
  lookupUserIdByEmailHash: LookupUserIdByEmailHash;
}

function mapWhere(model: string, where: Where[] | undefined, context: ProtectionContext): Where[] | undefined {
  if (model !== "user" || !where) {
    return where;
  }
  return where.map((condition) => {
    if (condition.field !== "email") {
      return condition;
    }
    const { value } = condition;
    if (typeof value === "string") {
      return { ...condition, value: context.protection.hashEmail(value) };
    }
    if (Array.isArray(value)) {
      return { ...condition, value: value.map((item) => context.protection.hashEmail(String(item))) };
    }
    return condition;
  });
}

function encodeData(model: string, data: AdapterRow, context: ProtectionContext): AdapterRow {
  if (model === "user" && typeof data.email === "string") {
    return { ...data, email: context.protection.hashEmail(data.email), emailCiphertext: context.protection.encrypt(data.email) };
  }
  if (model === "verification" && typeof data.value === "string") {
    return { ...data, value: context.protection.encrypt(data.value) };
  }
  return data;
}

function decodeRow<Row>(model: string, row: Row, context: ProtectionContext): Row {
  if (!row || typeof row !== "object") {
    return row;
  }
  const decoded: AdapterRow = { ...(row as AdapterRow) };
  if (model === "user" && typeof decoded.emailCiphertext === "string") {
    decoded.email = context.protection.decrypt(decoded.emailCiphertext);
    delete decoded.emailCiphertext;
  }
  if (model === "verification" && typeof decoded.value === "string") {
    decoded.value = context.protection.decrypt(decoded.value);
  }
  if (decoded.user && typeof decoded.user === "object") {
    decoded.user = decodeRow("user", decoded.user, context);
  }
  return decoded as Row;
}

function emailLookupValue(model: string, where: Where[]): string | undefined {
  const [condition] = where;
  if (model !== "user" || where.length !== 1 || condition?.field !== "email" || typeof condition.value !== "string") {
    return undefined;
  }
  return condition.value;
}

function protectMethods(inner: DBTransactionAdapter, context: ProtectionContext): DBTransactionAdapter {
  const findOne = async (input: { model: string; where: Where[]; select?: string[] }) => {
    const email = emailLookupValue(input.model, input.where);
    if (email === undefined) {
      const row = await inner.findOne<AdapterRow>({ ...input, where: mapWhere(input.model, input.where, context) ?? [] });
      return decodeRow(input.model, row, context);
    }
    const userId = await context.lookupUserIdByEmailHash(context.protection.hashEmail(email));
    if (userId === null) {
      return null;
    }
    const row = await inner.findOne<AdapterRow>({ ...input, where: [{ field: "id", value: userId }] });
    return decodeRow(input.model, row, context);
  };

  return {
    ...inner,
    create: (async (input: { model: string; data: AdapterRow; select?: string[]; forceAllowId?: boolean }) => {
      const row = await inner.create<AdapterRow>({ ...input, data: encodeData(input.model, input.data, context) });
      return decodeRow(input.model, row, context);
    }) as DBAdapter["create"],
    findOne: findOne as DBAdapter["findOne"],
    findMany: (async (input: Parameters<DBAdapter["findMany"]>[0]) => {
      const rows = await inner.findMany<AdapterRow>({ ...input, where: mapWhere(input.model, input.where, context) });
      return rows.map((row) => decodeRow(input.model, row, context));
    }) as DBAdapter["findMany"],
    count: (input) => inner.count({ ...input, where: mapWhere(input.model, input.where, context) }),
    update: (async (input: Parameters<DBAdapter["update"]>[0]) => {
      const update = encodeData(input.model, input.update, context);
      const row = await inner.update<AdapterRow>({ ...input, where: mapWhere(input.model, input.where, context) ?? [], update });
      return decodeRow(input.model, row, context);
    }) as DBAdapter["update"],
    updateMany: (input) =>
      inner.updateMany({
        ...input,
        where: mapWhere(input.model, input.where, context) ?? [],
        update: encodeData(input.model, input.update, context),
      }),
    delete: (input) => inner.delete({ ...input, where: mapWhere(input.model, input.where, context) ?? [] }),
    deleteMany: (input) => inner.deleteMany({ ...input, where: mapWhere(input.model, input.where, context) ?? [] }),
    consumeOne: (async (input: Parameters<DBAdapter["consumeOne"]>[0]) => {
      const row = await inner.consumeOne<AdapterRow>({ ...input, where: mapWhere(input.model, input.where, context) ?? [] });
      return decodeRow(input.model, row, context);
    }) as DBAdapter["consumeOne"],
    incrementOne: (async (input: Parameters<DBAdapter["incrementOne"]>[0]) => {
      const row = await inner.incrementOne<AdapterRow>({ ...input, where: mapWhere(input.model, input.where, context) ?? [] });
      return decodeRow(input.model, row, context);
    }) as DBAdapter["incrementOne"],
  };
}

export function protectAdapter(inner: DBAdapter, context: ProtectionContext): DBAdapter {
  return {
    ...protectMethods(inner, context),
    transaction: (callback) => inner.transaction((transactionAdapter) => callback(protectMethods(transactionAdapter, context))),
  };
}

import { domainToASCII } from 'node:url';

export type NormalizedEmail =
  | { ok: true; email: string; normalized: string }
  | { ok: false };

const INVALID: NormalizedEmail = { ok: false };
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const CONTROL = /[\u0000-\u001F\u007F]/;
const LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;

/** Sección 6 de la guía: normaliza y valida un correo. Nunca lanza. */
export function normalizeEmail(input: unknown): NormalizedEmail {
  if (typeof input !== 'string' || input.length > 320) return INVALID;

  let value = input.replace(ZERO_WIDTH, '').trim();
  if (CONTROL.test(value) || /\s/.test(value)) return INVALID;
  value = value.normalize('NFC');

  const parts = value.split('@');
  if (parts.length !== 2) return INVALID;
  const [local, rawDomain] = parts;

  if (!LOCAL_PART.test(local)) return INVALID;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return INVALID;

  if (!rawDomain) return INVALID;
  const domain = domainToASCII(rawDomain.toLowerCase());
  if (!domain || domain.length > 253) return INVALID;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return INVALID;
  if (!TLD.test(labels[labels.length - 1])) return INVALID;

  const normalized = `${local.toLowerCase()}@${domain}`;
  if (normalized.length > 254 || value.length > 254) return INVALID;

  return { ok: true, email: value, normalized };
}

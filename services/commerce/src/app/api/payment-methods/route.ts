import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/auth";
import { requireCustomer } from "@/lib/customer";
import { failure } from "@/lib/http";
import { ApiError } from "@/lib/transaction";
import { gatewayConfigured, tokenize, type TokenizePayload } from "@/lib/gateway";

export async function GET() {
  try {
    const customer = await requireCustomer();
    const methods = await db.savedPaymentMethod.findMany({
      where: { userId: customer.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        vaultToken: true,
        paymentMethod: true,
        label: true,
        last4: true,
        currency: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ methods }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const customer = await requireCustomer();
    const body = await req.json();

    const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : "stripe_card";
    const currency = body.currency === "USD" ? "USD" : "EGP";
    let payload: TokenizePayload;
    let label: string;
    let fallbackLast4: string | null = null;

    if (body.card && typeof body.card.number === "string") {
      const digits = body.card.number.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) {
        throw new ApiError(400, "Enter a valid card number to save");
      }
      fallbackLast4 = digits.slice(-4);
      label = `${paymentMethod === "visa" ? "Visa" : "Card"} •••• ${fallbackLast4}`;
      payload = {
        card: {
          number: digits,
          exp_month: Number(body.card.exp_month) || 12,
          exp_year: Number(body.card.exp_year) || 2028,
          cvv: String(body.card.cvv || "123"),
        },
      };
    } else if (
      (paymentMethod === "instapay" || paymentMethod === "vodafone_cash" || paymentMethod === "paypal") &&
      typeof body.accountIdentifier === "string" &&
      body.accountIdentifier.trim().length >= 3
    ) {
      const id = body.accountIdentifier.trim();
      fallbackLast4 = id.slice(-4);
      label =
        paymentMethod === "instapay"
          ? `InstaPay (${id})`
          : paymentMethod === "vodafone_cash"
            ? `Vodafone Cash (${id})`
            : `PayPal (${id})`;
      payload = { payment_method: paymentMethod, account_identifier: id };
    } else {
      throw new ApiError(400, "Provide card details or a valid wallet/account identifier");
    }

    let vaultToken: string;
    let last4 = fallbackLast4;
    if (gatewayConfigured) {
      const res = await tokenize(payload);
      vaultToken = res.vault_token;
      last4 = res.last4 ?? fallbackLast4;
    } else {
      vaultToken = `vault_tok_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    }

    const saved = await db.savedPaymentMethod.upsert({
      where: { vaultToken },
      update: { label, last4, currency, paymentMethod },
      create: {
        userId: customer.id,
        vaultToken,
        paymentMethod,
        label,
        last4,
        currency,
      },
      select: {
        id: true,
        vaultToken: true,
        paymentMethod: true,
        label: true,
        last4: true,
        currency: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ method: saved }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

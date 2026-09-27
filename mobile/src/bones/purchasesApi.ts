import { Platform } from 'react-native';
import Purchases, { PURCHASES_ERROR_CODE } from 'react-native-purchases';
import type { PurchasesError, PurchasesPackage } from 'react-native-purchases';
import { supabase } from '../lib/supabase';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// RevenueCat's per-platform *public* SDK key — see .env.example for
// where these come from and why they're safe in the app bundle.
const apiKey =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : Platform.OS === 'android'
      ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
      : undefined;

export const isPurchasesConfigured = Boolean(apiKey);

let configuredForUserId: string | null = null;

// Lazy configure/re-identify — same shape as src/auth/googleSignIn.ts's
// ensureConfigured(), since nothing needs the RevenueCat SDK touched
// until someone actually opens the Bones shop. appUserID is the Supabase
// user id directly: sync-purchase and revenuecat-webhook
// (0064_bones_purchases.sql) trust it as profiles.id with no separate
// mapping, so this must always be called with that same id.
async function ensureConfigured(userId: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Same "not on this platform" story as Google Sign-In's own web
    // throw (src/auth/googleSignIn.ts) — there's no purchase flow to
    // fall back to in a browser preview.
    throw new Error("Buying Bones isn't available in the web preview — run a native build to use it.");
  }
  if (!apiKey) {
    throw new Error('Bones purchases need EXPO_PUBLIC_REVENUECAT_IOS_KEY/ANDROID_KEY set — see .env.example.');
  }
  if (configuredForUserId === userId) return;
  if (configuredForUserId === null) {
    Purchases.configure({ apiKey, appUserID: userId });
  } else {
    await Purchases.logIn(userId);
  }
  configuredForUserId = userId;
}

export interface BonesPackOffer {
  productId: string;
  bonesAmount: number;
  priceString: string;
  pkg: PurchasesPackage;
}

// bones_products (0064_bones_purchases.sql) is the source of truth for
// which packs exist and how many Bones each is worth; RevenueCat's
// current offering is the source of truth for whether that product is
// actually purchasable right now and at what live, correctly-localized
// price. A pack only shows up here when both agree — e.g. a product
// added to bones_products but not yet finished in the RevenueCat
// dashboard is silently left off rather than shown broken.
export async function listBonesPackOffers(userId: string): Promise<BonesPackOffer[]> {
  await ensureConfigured(userId);
  const client = requireClient();
  const [{ data, error }, offerings] = await Promise.all([
    client.from('bones_products').select('id, bones_amount').eq('active', true).order('bones_amount', { ascending: true }),
    Purchases.getOfferings(),
  ]);
  if (error) throw new Error(error.message);

  const packagesByProductId = new Map(
    (offerings.current?.availablePackages ?? []).map((pkg) => [pkg.product.identifier, pkg]),
  );
  return (data ?? []).flatMap((row) => {
    const pkg = packagesByProductId.get(row.id as string);
    if (!pkg) return [];
    return [{ productId: row.id as string, bonesAmount: row.bones_amount as number, priceString: pkg.product.priceString, pkg }];
  });
}

// Purchases through RevenueCat, then tells the backend right away
// (sync-purchase) so the balance updates without waiting for
// revenuecat-webhook — which still runs as the safety net if this second
// call never happens (app killed right after purchase). Either path
// calls the same credit_bones_purchase, and its own
// unique (store, transaction_id) constraint makes the two racing
// harmless, so there's no double-credit risk from doing both.
//
// Returns `credited: false` (not an error) when the purchase itself
// succeeded but the sync call failed — a screen should tell the person
// their Bones may take a minute, not that the purchase failed, since it
// didn't: they were charged and revenuecat-webhook will still catch it.
export async function purchaseBonesPack(userId: string, offer: BonesPackOffer): Promise<{ credited: boolean }> {
  await ensureConfigured(userId);

  let transactionId: string;
  try {
    const { transaction } = await Purchases.purchasePackage(offer.pkg);
    transactionId = transaction.transactionIdentifier;
  } catch (e) {
    const err = e as PurchasesError;
    if (err.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      throw new Error('Purchase cancelled.');
    }
    throw new Error(err.message || 'Purchase failed.');
  }

  const store = Platform.OS === 'ios' ? 'app_store' : 'play_store';
  const { error } = await requireClient().functions.invoke('sync-purchase', {
    body: { productId: offer.productId, transactionId, store },
  });
  return { credited: !error };
}

# Claude Code Prompt: Fix Product Dropdown — Direct Supabase Query

## Context

The product dropdown in the upload form shows "No products yet" even though products exist in the `shopify_products` table. The `/api/brand-products` API route returns 200 but silently returns empty data due to a build/module issue.

**Fix:** Replace the API-based product fetching with a direct Supabase query from the client. The browser client already has the user's auth session, and the RLS policy (`brand_id = current_user_brand_id()`) allows users to see their own brand's products. This eliminates the server-side API as a point of failure.

## Changes to make

### 1. `src/components/SubmissionForm.tsx` — Fix the product-fetching useEffect (~line 226)

**Current code (broken — relies on /api/brand-products):**
```typescript
useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedBrandId) {
        setBrandProducts([]);
        return;
      }
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`/api/brand-products?brand_id=${selectedBrandId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setBrandProducts(json.products || []);
        }
      } catch {
        // silently fail — products are optional
      }
    };
    fetchProducts();
  }, [selectedBrandId]);
```

**Replace with:**
```typescript
useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedBrandId) {
        setBrandProducts([]);
        return;
      }
      try {
        const supabase = createClient();
        const { data: products, error } = await supabase
          .from('shopify_products')
          .select('shopify_product_id, title, product_type, handle')
          .eq('brand_id', selectedBrandId)
          .eq('status', 'active')
          .order('product_type')
          .order('title');

        if (error) {
          console.error('Product fetch error:', error);
          return;
        }

        const result = [
          { shopify_product_id: '__brand_general__', title: 'Brand / General', product_type: '', handle: '' },
          ...(products || []).map((p: any) => ({
            shopify_product_id: String(p.shopify_product_id),
            title: p.title,
            product_type: p.product_type || '',
            handle: p.handle || '',
          })),
        ];
        setBrandProducts(result);
      } catch (err) {
        console.error('Product fetch failed:', err);
      }
    };
    fetchProducts();
  }, [selectedBrandId]);
```

Key changes:
- Queries `shopify_products` directly via the Supabase browser client (no API call)
- RLS policy handles access control — users only see their own brand's products
- Converts `shopify_product_id` from BIGINT (number) to string with `String()` to match the TypeScript interface
- Prepends the "Brand / General" placeholder option
- Logs errors instead of silently swallowing them

### 2. `src/components/SubmissionForm.tsx` — Fix the product refresh in handleSyncProducts (~line 207)

In the `handleSyncProducts` callback, the product refresh after syncing also calls the broken API. Replace that part too.

**Current code (the refresh portion after the sync call):**
```typescript
      // Refresh the product list
      const productsRes = await fetch(`/api/brand-products?brand_id=${selectedBrandId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (productsRes.ok) {
        const productsData = await productsRes.json();
        setBrandProducts(productsData.products || []);
      }
```

**Replace with:**
```typescript
      // Refresh the product list directly from Supabase
      const refreshSupabase = createClient();
      const { data: refreshedProducts } = await refreshSupabase
        .from('shopify_products')
        .select('shopify_product_id, title, product_type, handle')
        .eq('brand_id', selectedBrandId)
        .eq('status', 'active')
        .order('product_type')
        .order('title');

      const refreshedResult = [
        { shopify_product_id: '__brand_general__', title: 'Brand / General', product_type: '', handle: '' },
        ...(refreshedProducts || []).map((p: any) => ({
          shopify_product_id: String(p.shopify_product_id),
          title: p.title,
          product_type: p.product_type || '',
          handle: p.handle || '',
        })),
      ];
      setBrandProducts(refreshedResult);
```

### 3. Remove the auth header / session check from both functions

Since the Supabase browser client (`createBrowserClient` from `@supabase/ssr`) automatically includes the user's auth session via cookies, you no longer need to manually get the session and pass an Authorization header for the product fetch. The `supabase.auth.getSession()` call is still needed in `handleSyncProducts` for the `/api/sync-products` POST call (which requires a Bearer token), but NOT for the direct Supabase queries.

In the useEffect (fetchProducts), you can remove the `getSession()` + `if (!session) return` check entirely since the browser client handles auth automatically.

## What NOT to change

- Don't modify the `/api/brand-products/route.ts` file — leave it as-is
- Don't modify the `/api/sync-products/route.ts` file
- Don't change the `handleSyncProducts` POST call to `/api/sync-products` — that still needs the Bearer token
- Don't change the FileCard component
- Don't change the product dropdown rendering logic
- Don't change the batch defaults product dropdown
- Don't change how `productId` / `productName` are stored in fileContexts

## Why this works

The `shopify_products` table has RLS enabled with a policy: `brand_id = current_user_brand_id()`. The `current_user_brand_id()` function looks up the logged-in user's `brand_id` from `users_profile`. So a Tallow Twins strategist sees TT products, a FOND strategist sees FOND products, etc. No service role key needed.

The BIGINT `shopify_product_id` column returns numbers from PostgREST. The `String()` conversion ensures they match the TypeScript `string` type used throughout the component and in FileCard.

## Files to modify

1. `src/components/SubmissionForm.tsx` — two changes (useEffect and handleSyncProducts)

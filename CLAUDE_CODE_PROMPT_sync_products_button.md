# Claude Code Prompt: Add "Sync Products" Button to Upload Page

## Context

The `/api/sync-products` endpoint exists and works — it pulls products from Shopify for all brands (or a specific brand) and upserts them into the `shopify_products` table. But there's no UI to trigger it. The product dropdowns in the upload form are empty because no one has triggered the sync yet.

## What to build

Add a small "Sync Products" button next to the Product dropdown in the upload form's batch defaults bar. When clicked, it calls `POST /api/sync-products` with the currently selected brand's ID, waits for the response, then refreshes the product list.

### Implementation

In `src/components/SubmissionForm.tsx` (or `FileCard.tsx` if the product dropdown lives there):

1. Add a sync button — a small icon button (refresh/sync icon) next to the Product dropdown or near the batch defaults bar. Style it as a subtle icon button, not a big primary button.

2. On click:
```typescript
const handleSyncProducts = async () => {
  setSyncing(true);
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    
    const res = await fetch('/api/sync-products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ brand_id: selectedBrandId }),
    });
    
    const data = await res.json();
    
    // Refresh the product list
    const productsRes = await fetch(`/api/brand-products?brand_id=${selectedBrandId}`);
    const productsData = await productsRes.json();
    setBrandProducts(productsData.products || []);
    
    // Show success feedback (toast, or just update the button state briefly)
  } catch (err) {
    console.error('Product sync failed:', err);
  } finally {
    setSyncing(false);
  }
};
```

3. Button UI:
- Show a refresh icon (use whatever icon library the project already uses — likely lucide-react or heroicons)
- While syncing: show a spinner or the icon spinning with CSS animation
- After success: briefly show a checkmark, then revert to the refresh icon
- Tooltip or aria-label: "Sync products from Shopify"

4. The `supabase` client should already be available in the component (it's used elsewhere in the form). Use whatever import pattern the rest of the codebase uses — check existing components for how they get the supabase client and auth session.

### Where to place it

Put it right next to the first Product dropdown the user sees — either in the batch defaults bar or next to the per-file product dropdown. A small icon button, not a big thing. If products are empty (only "Brand / General" showing), you could also show a subtle text hint like "No products yet — click sync to pull from Shopify" near the dropdown.

## Files to modify

1. `src/components/SubmissionForm.tsx` (or wherever the product dropdown currently renders)

## What NOT to change

- Don't modify the `/api/sync-products` endpoint itself
- Don't change the product dropdown behavior
- Don't add a whole new settings page for this — just a button inline with the existing UI

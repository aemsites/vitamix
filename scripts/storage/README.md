# Storage

This directory contains the file(s) that provide helper methods for other files to access the local
storage items that are treated the same way that Magento handles them - storing the items in
`mage-cache-storage`, tracking their invalidation status in `mage-cache-storage-section-invalidation`,
tracking the cache timeout in `mage-cache-timeout`, etc.

This is also where the actual contact with Magento is happening to refresh the local storage cache and
store the information coming directly from Magento.

**Note: this requires that the endpoint `/customer/section/load` is routed to Magento.**

## Store-Specific Cache Keys

To support multiple store views (US, Canada, Mexico, etc.) on the same domain, localStorage keys are
store-specific to prevent cart data conflicts between different stores.

### Key Naming Convention

- **US Store (`/us/en_us/`)**: Uses original key names without suffix for backward compatibility
  - `mage-cache-storage`
  - `mage-cache-timeout`
  - `mage-cache-storage-section-invalidation`

- **Other Stores**: Use store-specific suffixes in the format `-{locale}-{language}`
  - Example for French Canadian (`/ca/fr_ca/`):
    - `mage-cache-storage-ca-fr_ca`
    - `mage-cache-timeout-ca-fr_ca`
    - `mage-cache-storage-section-invalidation-ca-fr_ca`

### Benefits

- **Cart Isolation**: Each store view maintains its own cart, preventing conflicts when users switch between stores
- **Backward Compatibility**: Existing US customer carts are preserved (no migration required)
- **Multi-Store Support**: Users can have active carts in multiple stores simultaneously

### Helper Functions

The following helper functions generate the appropriate keys based on the current store:

- `getStoreSuffix()` - Returns the store-specific suffix or empty string for US
- `getCacheStorageKey()` - Returns the appropriate `mage-cache-storage` key
- `getCacheTimeoutKey()` - Returns the appropriate `mage-cache-timeout` key
- `getCacheInvalidationKey()` - Returns the appropriate invalidation key

All localStorage operations use these functions to ensure consistent key generation across the application.
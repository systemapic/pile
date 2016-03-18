### Tests

#### `raster-layer.test.js`
Will upload and create layer from `snow.raster.200.tif`

All returned objects are logged to console.

1. Uploads to `/v2/data/import`, gets `upload_status` in return.
2. Check for valid `upload_status`
3. Checks periodically for `upload_status` and checks for `processing_success` to be `true`
4. Creates a raster layer from uploaded dataset
5. Requests a raster-tile from raster layer, and checks against expected `png` file
6. Vectorizes raster dataset. Returns a status object.
7. Checks status to see if vectorization is done (ie. `processing_success`)
8. Creates a vector layer from vectorized dataset
9. Requests raster-tile from vector layer
10. Requests vector-tile from vector layer
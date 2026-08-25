# DryRoute Tile Service

Serves the Singapore Protomaps archive from `data/singapore.pmtiles` on port 8081.

The PMTiles archive is generated runtime data and is not committed to Git.

```bash
scripts/extract-singapore.sh
scripts/serve-pmtiles.sh
```

Both scripts require the `pmtiles` CLI. Set `PMTILES_BIN` to override its executable and `PORT` to override the serving port.

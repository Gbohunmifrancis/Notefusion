#!/usr/bin/env bash
# deploy/generate-rsa-key.sh — Generate the RSA-2048 private key used by the JWT token service.
#
# Run this once locally, then store the output in:
#   GitHub Secret → JWT_PRIVATE_KEY_PEM   (for CI/CD)
#
# The key is PKCS#8 PEM format.
#
# Usage:
#   bash deploy/generate-rsa-key.sh
#   # → prints the full PEM to stdout, which you paste into the GitHub secret.

set -euo pipefail

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null

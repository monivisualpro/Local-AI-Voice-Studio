#!/usr/bin/env bash
cd "$(dirname "$0")"
npm install --legacy-peer-deps && npm run dist:mac

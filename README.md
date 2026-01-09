# Staminads

[![Test & Coverage](https://github.com/staminads/staminads/actions/workflows/test.yml/badge.svg)](https://github.com/staminads/staminads/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/staminads/staminads/graph/badge.svg)](https://codecov.io/gh/staminads/staminads)

Staminads helps you categorize and measure the quality of your traffic sources.

It focuses on TimeScore metric, that is the median time spent by sessions per source of traffic.

A source of traffic can be any dimensions or combination of dimensions such as:

- UTM Campaign
- UTM Medium
- UTM Source
- Referrer Domain
- Country
- Device Type
- Page Path
- etc.

## Roadmap

- whitelist domains
- cross domain tracking (decorate urls?)
- detect old sdk usage if new sdk version is available
- detect stm_1 ...10 custom dimensions from URLs and map them to custom dimensions in sdk

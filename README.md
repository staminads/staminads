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

- make an e2e test to make sure a session with many pages correctly records the duration spent on every page in the final table

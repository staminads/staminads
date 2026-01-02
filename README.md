# Staminads

Staminads is a web analytics platform that collects and analyzes web sessions.

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

## Project Structure

```
/api          NestJS TypeScript API
/console      Frontend React Typescript Antd
```

## Roadmap

- custom bounce rate in secs
- warning on children dimensions having less than minimum sessions
- export to CSV
- SDK
- docs
- day of week as "Monday..." in Explore results
- "not-mapped" template in explore

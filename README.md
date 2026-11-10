# Sepoh – QuantStat

QuantStat is owned by Sepoh.

Free predictions for funds sold in Norway, the largest US ETFs, stocks on Oslo Børs, Euronext Expand and Euronext Growth, and US-listed stocks worth more than $2 billion:
search, top 10 best and worst, crash risk, dips, when to buy and a return calculator.
The same model is used for every fund and stock.

The website is built automatically by GitHub Actions (`.github/workflows/update.yml`) three times a day:
`oppdater.mjs` fetches the fund list from dnb.no, stock lists from Euronext and Nasdaq and prices from Yahoo Finance,
calculates the predictions and fills `mal.html` with the data. The result is published with GitHub Pages.

Run locally: `node oppdater.mjs ut symbols.json mal.html` and open `ut/index.html`.

The model's source code is in the QuantStat project (TypeScript); `oppdater.mjs` and `mal.html` are built files from there.
Not investment advice.

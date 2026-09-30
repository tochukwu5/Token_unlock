# Unlock Short Bot

Scans every token unlock that DefiLlama tracks once a day. When a big unlock is coming in the next 3–30 days and the coin can be shorted on Binance or Bybit, it sends a Telegram alert with a picture card. Each unlock is alerted **only once**.

## How it decides (the edge)

A coin only gets an alert if it passes every filter below:

1. The unlock is **3–30 days away**. Most of the drop usually happens in the month before an unlock, not on the day itself.
2. The unlock is **at least 2% of circulating supply** and worth **at least $1M**.
3. The market cap is **under $5B**. Big coins absorb unlocks easily.
4. A **USDT perpetual exists** on Binance or Bybit, with at least **$2M** of futures volume.
5. The **Edge Score is 55 or higher** (out of 100):

| Factor | Max points |
|---|---|
| Unlock size vs circulating supply | 30 |
| Unlock value vs normal 24h volume (can the market absorb it?) | 20 |
| Who gets the tokens (team and VCs sell most; ecosystem and treasury sell least) | 20 |
| Small market cap | 10 |
| Funding rate (positive means shorts get paid) | 10 |
| Short crowding (open interest vs market cap) | 10 |
| Penalty: already down 40%+ in 30 days, or up 30%+ this week | −5 to −8 |

Linear (drip) unlocks are ignored. Only cliff unlocks, where a big amount is released on one day, are counted.

## What else it does

- **No repeats.** Every unlock it alerts is saved in `alerts.json`, and later scans skip it.
- **Result tracking.** It records the price on unlock day and 7 days later, then sends a "📊 Unlock result" message with the short's return and your running win rate. This shows whether the strategy really works before you put serious money in.
- **Error alerts.** If a scan fails, you get a Telegram message saying why.

## Setup, step by step

### 1. Create the Telegram bot
1. In Telegram, open **@BotFather** and send `/newbot`. Copy the **token**.
2. Send any message to your new bot. Your friend should do the same, or add the bot to a group.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy each `"chat":{"id": ...}`. Group IDs start with `-100`.

### 2. Get a free CoinGecko key (recommended)
Railway's shared IPs often get rate-limited by CoinGecko. Create a free **Demo** key at coingecko.com/en/developers/dashboard.

### 3. Test on your computer first
```bash
npm install
cp .env.example .env          # fill in the values
node --env-file=.env src/index.js --test-alert   # sends a sample alert to check Telegram + the picture
node --env-file=.env src/index.js --dry-run      # real scan, prints alerts without sending
npm run mock                                     # offline test with made-up data
```

### 4. Deploy on Railway
1. Push this folder to a GitHub repo. In Railway, choose **New Project → Deploy from GitHub repo**.
2. **Settings → Region:** choose **EU West (Amsterdam)** or **Southeast Asia (Singapore)**. ⚠️ Binance and Bybit block US servers, so a US region will not work.
3. **Add a Volume:** right-click the service, choose **Attach Volume**, and set the mount path to `/data`. Without it, the "already sent" memory is wiped on every redeploy.
4. **Variables:** add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `COINGECKO_API_KEY` and `DATA_DIR=/data`. Everything else has defaults (see `.env.example`).
5. Deploy. You'll get a "🤖 Unlock short bot is live" message, and the first scan runs straight away. After that it scans every day at 08:00 Lagos time.

A full scan downloads roughly 370 unlock files from DefiLlama, so it takes a few minutes. That's normal.

## Settings you may want to change

| Variable | Default | Meaning |
|---|---|---|
| `SCAN_CRON` | `0 8 * * *` | When to scan (cron format, in `TIMEZONE`) |
| `WINDOW_DAYS` / `MIN_DAYS_AHEAD` | 30 / 3 | Alert when the unlock is this many days away |
| `MIN_UNLOCK_PCT` | 2 | Minimum unlock size as % of circulating supply |
| `MIN_SCORE` | 55 | Raise to 65–70 for fewer, stronger alerts |
| `EXCHANGES` | `binance,bybit` | Where to look for a perp to short |
| `SEND_DAILY_SUMMARY` | false | Also send a short "scan done" message every day |

## Risk notes
- Short squeezes are the main danger. One backtest of this exact idea hit an 86% drawdown from a single squeeze. Use low leverage and always use a stop-loss.
- The alert's Squeeze Risk and warning lines (negative funding, high open interest, strong pump) are there to help you skip crowded trades.
- DefiLlama unlock data can have mistakes. Check the linked DefiLlama page before trading.
- This is a research tool, not financial advice.

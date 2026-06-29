# Strategy Simulator Dashboard - GitHub Pages Ready

This project implements the requirements for **Task 2 - Building the Research Foundation** of the IIT Bombay Research Internship. It features EOD daily price streams, a validated cost-aware simulation backtester, classical baseline strategies (SMA Crossover, Bollinger Bands, and Pairs Trading), and an **interactive static web dashboard** that runs 100% in the browser.

---

## 🌐 Deploying to GitHub Pages (Serverless)

Because the backtesting logic and CSV parsing have been ported entirely to client-side JavaScript, this dashboard runs serverless on **GitHub Pages**.

### Steps to Deploy:
1.  **Create a new GitHub Repository** (e.g., `strategy-simulator`).
2.  **Push the contents** of this directory to the repository (make sure `index.html`, `style.css`, `app.js`, and the `data/` folder are at the **root** of the repo).
3.  Go to your repository settings on GitHub:
    *   Navigate to **Settings** > **Pages** (in the sidebar).
    *   Under **Build and deployment**, select **Deploy from a branch**.
    *   Choose the branch (typically `main`) and folder (`/ (root)`), then click **Save**.
4.  Your site will be live at: `https://<your-github-username>.github.io/strategy-simulator/`

---

## 🛠️ Testing the Dashboard Locally

Browsers restrict loading local CSV data files using `fetch` or AJAX when opening raw HTML files directly from your hard drive (`file://` protocol) due to security policies. 

To run and test the static dashboard locally, you need a local web server:

### Option 1: Use Python's Built-In HTTP Server (Recommended)
Open your terminal inside this directory and run:
```bash
python -m http.server 5000
```
Then open your browser and navigate to:
👉 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

### Option 2: Use Node.js Static Server
If you have Node.js installed:
```bash
npx serve
```
Then navigate to the URL provided in the terminal.

---

## 📁 Project Directory Structure

```text
crypto_backtester/
│
├── index.html              # Dashboard interface (references PapaParse & Chart.js CDNs)
├── style.css               # Glassmorphic dark mode styling
├── app.js                  # Pure-JS Client-Side backtesting engine & simulation loop
│
├── data_engine.py          # Script for fetching daily historical data
├── custom_backtester.py    # Python custom simulator (with sanity validation tests)
├── run_baselines.py        # Python baseline strategies execution & backtesting.py check
├── generate_report.py      # Python script to build the Task2_Research_Foundation.docx Word report
│
├── data/                   # Historical CSV data folder
│   ├── BTCUSDT_daily.csv
│   ├── ETHUSDT_daily.csv
│   ├── TCS_daily.csv
│   └── INFY_daily.csv
│
└── Task2_Research_Foundation.docx # Final generated Microsoft Word report
```

---

## 📊 Summary of Baseline Strategy Results

A summary of the strategy performances on our simulator:

| Asset | Strategy | CAGR (%) | Volatility (%) | Sharpe Ratio | Max Drawdown (%) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BTCUSDT** | SMA Crossover (Long-Only) | **26.19%** | **46.84%** | **0.736** | **-66.81%** |
| **TCS** | SMA Crossover (Long-Only) | **4.82%** | **18.32%** | **0.354** | **-28.53%** |
| **BTCUSDT** | Bollinger Bands Reversion | **-29.42%** | **50.87%** | **-0.422** | **-96.98%** |
| **TCS** | Bollinger Bands (Long-Only) | **-3.50%** | **12.77%** | **-0.221** | **-34.77%** |
| **BTC/ETH** | Pairs Trading (L/S) | **-14.47%** | **17.25%** | **-0.820** | **-74.04%** |
| **TCS/INFY** | Pairs Trading (L/S) | **-0.43%** | **4.20%** | **-0.083** | **-12.49%** |

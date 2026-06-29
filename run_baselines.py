import os
import pandas as pd
import numpy as np
# Monkeypatch for NumPy 2.x compatibility with backtesting.py
if not hasattr(np, 'bool8'):
    np.bool8 = np.bool_
if not hasattr(np, 'int0'):
    np.int0 = np.intp

import matplotlib.pyplot as plt
from custom_backtester import CustomBacktester

# Setup directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
PLOTS_DIR = os.path.join(BASE_DIR, "plots")
os.makedirs(PLOTS_DIR, exist_ok=True)

# Helper function to load data
def load_dataset(name):
    path = os.path.join(DATA_DIR, f"{name}_daily.csv")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Dataset not found at {path}. Run data_engine.py first.")
    df = pd.read_csv(path)
    df["Date"] = pd.to_datetime(df["Date"]).dt.date
    return df

# 1. SMA Crossover Strategy Signal Generator
def generate_sma_signals(df, fast=50, slow=200):
    close = df["Close"]
    fast_sma = close.rolling(fast).mean()
    slow_sma = close.rolling(slow).mean()
    
    # 1 when fast > slow, 0 otherwise
    signals = np.where(fast_sma > slow_sma, 1.0, 0.0)
    # Mark NaNs at start as 0
    signals[np.isnan(fast_sma) | np.isnan(slow_sma)] = 0.0
    return signals

# 2. Bollinger Band Mean Reversion Signal Generator
def generate_bb_signals(df, period=20, num_std=2, long_only=True):
    close = df["Close"].values
    sma = df["Close"].rolling(period).mean().values
    std = df["Close"].rolling(period).std().values
    lower = sma - num_std * std
    upper = sma + num_std * std
    
    signals = np.zeros(len(df))
    pos = 0 # 0=cash, 1=long, -1=short
    
    for i in range(len(df)):
        if np.isnan(lower[i]) or np.isnan(upper[i]):
            signals[i] = 0.0
            continue
            
        c = close[i]
        l = lower[i]
        u = upper[i]
        m = sma[i]
        
        if pos == 0:
            if c < l:
                pos = 1
            elif c > u and not long_only:
                pos = -1
        elif pos == 1: # Long exit at middle band
            if c >= m:
                pos = 0
        elif pos == -1: # Short exit at middle band
            if c <= m:
                pos = 0
                
        signals[i] = float(pos)
        
    return signals

# 3. Pairs Trading Signal Generator (Rolling OLS)
def generate_pairs_signals(df1, df2, window=60, entry_z=1.5, exit_z=0.0, long_only=False):
    # Align datasets on Date
    m_df = pd.merge(df1[["Date", "Close"]], df2[["Date", "Close"]], on="Date", suffixes=("_1", "_2"))
    m_df = m_df.sort_values("Date").reset_index(drop=True)
    
    close1 = m_df["Close_1"].values
    close2 = m_df["Close_2"].values
    
    betas = np.zeros(len(m_df))
    alphas = np.zeros(len(m_df))
    z_scores = np.zeros(len(m_df))
    
    for i in range(window, len(m_df)):
        x = close1[i-window:i]
        y = close2[i-window:i]
        
        # Fit OLS: y = beta * x + alpha
        cov = np.cov(x, y)
        if cov[0, 0] > 0:
            beta = cov[0, 1] / cov[0, 0]
        else:
            beta = 0.0
        alpha = np.mean(y) - beta * np.mean(x)
        
        betas[i] = beta
        alphas[i] = alpha
        
        # Calculate rolling spread stats
        spreads = y - (beta * x + alpha)
        spread_mean = np.mean(spreads)
        spread_std = np.std(spreads)
        
        current_spread = close2[i] - (beta * close1[i] + alpha)
        z_scores[i] = (current_spread - spread_mean) / spread_std if spread_std > 0 else 0.0
        
    signals_1 = np.zeros(len(m_df))
    signals_2 = np.zeros(len(m_df))
    pos = 0 # 0=cash, 1=long spread, -1=short spread
    
    for i in range(window, len(m_df)):
        z = z_scores[i]
        
        if pos == 0:
            if z < -entry_z:
                pos = 1
            elif z > entry_z:
                pos = -1
        elif pos == 1:
            if z >= exit_z:
                pos = 0
        elif pos == -1:
            if z <= exit_z:
                pos = 0
                
        if pos == 1:
            # Long Asset 2, Short Asset 1
            signals_2[i] = 0.5
            signals_1[i] = -0.5 if not long_only else 0.0
        elif pos == -1:
            # Short Asset 2, Long Asset 1
            signals_2[i] = -0.5 if not long_only else 0.0
            signals_1[i] = 0.5
            
    return m_df, signals_1, signals_2

# Plot helper
def plot_equity_and_drawdown(dates, equity, name, market_type, filename):
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8), sharex=True)
    
    # Equity curve
    ax1.plot(dates, equity, label="Strategy Equity (Net)", color="#1f77b4", linewidth=1.5)
    ax1.set_title(f"Equity Curve & Drawdowns: {name} ({market_type.replace('_', ' ').title()})")
    ax1.set_ylabel("Portfolio Value ($)")
    ax1.grid(True, linestyle="--", alpha=0.5)
    ax1.legend()
    
    # Drawdowns
    peaks = pd.Series(equity).cummax()
    drawdowns = (pd.Series(equity) - peaks) / peaks * 100
    ax2.fill_between(dates, drawdowns, 0, color="#d62728", alpha=0.3, label="Drawdown [%]")
    ax2.set_ylabel("Drawdown (%)")
    ax2.set_xlabel("Date")
    ax2.grid(True, linestyle="--", alpha=0.5)
    ax2.legend()
    
    plt.tight_layout()
    plt.savefig(os.path.join(PLOTS_DIR, filename), dpi=150)
    plt.close()

# Official backtesting.py verification runner
def run_backtesting_py_comparison(df, strategy_name):
    """
    Runs the official backtesting.py package on the same dataset
    to verify our results.
    """
    try:
        from backtesting import Backtest, Strategy
        from backtesting.lib import crossover
        
        # Format df for backtesting.py (requires columns to be capitalized: Open, High, Low, Close, Volume)
        bt_df = df.copy()
        bt_df["Date"] = pd.to_datetime(bt_df["Date"])
        bt_df = bt_df.set_index("Date")
        
        if strategy_name == "SMA_Crossover":
            class SmaCross(Strategy):
                def init(self):
                    self.fast_sma = self.I(lambda x: pd.Series(x).rolling(50).mean(), self.data.Close)
                    self.slow_sma = self.I(lambda x: pd.Series(x).rolling(200).mean(), self.data.Close)
                    
                def next(self):
                    if crossover(self.fast_sma, self.slow_sma):
                        self.buy()
                    elif crossover(self.slow_sma, self.fast_sma):
                        self.position.close()
            
            bt = Backtest(bt_df, SmaCross, cash=100000, commission=0.001) # 0.1% fee
            stats = bt.run()
            return stats
            
        elif strategy_name == "Bollinger_Bands":
            class BBCross(Strategy):
                def init(self):
                    self.sma = self.I(lambda x: pd.Series(x).rolling(20).mean(), self.data.Close)
                    self.std = self.I(lambda x: pd.Series(x).rolling(20).std(), self.data.Close)
                    
                def next(self):
                    close = self.data.Close[-1]
                    lower = self.sma[-1] - 2 * self.std[-1]
                    upper = self.sma[-1] + 2 * self.std[-1]
                    middle = self.sma[-1]
                    
                    if not self.position:
                        if close < lower:
                            self.buy()
                    else:
                        if close >= middle:
                            self.position.close()
            
            bt = Backtest(bt_df, BBCross, cash=100000, commission=0.001)
            stats = bt.run()
            return stats
    except Exception as e:
        print(f"[!] Warning: backtesting.py check failed: {e}")
        return None

if __name__ == "__main__":
    print("[*] Loading datasets for backtesting baselines...")
    btc_df = load_dataset("BTCUSDT")
    eth_df = load_dataset("ETHUSDT")
    tcs_df = load_dataset("TCS")
    infy_df = load_dataset("INFY")
    
    results = []
    
    # ----------------------------------------------------
    # Baseline 1: Trend Following (SMA Crossover)
    # ----------------------------------------------------
    print("\n[*] Evaluating Strategy 1: SMA Crossover (50, 200)...")
    # Crypto (BTCUSDT)
    btc_sma_sigs = generate_sma_signals(btc_df)
    btc_sma_tester = CustomBacktester(btc_df, market_type="crypto")
    eq_net, eq_gross, trades = btc_sma_tester.run_simulation(btc_sma_sigs, long_only=True)
    btc_sma_metrics = btc_sma_tester.compute_metrics(eq_net, eq_gross, trades)
    results.append(("BTCUSDT", "SMA Crossover", btc_sma_metrics))
    plot_equity_and_drawdown(btc_df["Date"], eq_net, "SMA Crossover (BTC)", "crypto", "btc_sma_crossover.png")
    
    # Indian Equities (TCS)
    tcs_sma_sigs = generate_sma_signals(tcs_df)
    tcs_sma_tester = CustomBacktester(tcs_df, market_type="indian_equities")
    eq_net, eq_gross, trades = tcs_sma_tester.run_simulation(tcs_sma_sigs, long_only=True)
    tcs_sma_metrics = tcs_sma_tester.compute_metrics(eq_net, eq_gross, trades)
    results.append(("TCS", "SMA Crossover", tcs_sma_metrics))
    plot_equity_and_drawdown(tcs_df["Date"], eq_net, "SMA Crossover (TCS)", "indian_equities", "tcs_sma_crossover.png")
    
    # ----------------------------------------------------
    # Baseline 2: Mean Reversion (Bollinger Bands)
    # ----------------------------------------------------
    print("\n[*] Evaluating Strategy 2: Bollinger Bands (20, 2)...")
    # Crypto (BTCUSDT) - Long/Short allowed
    btc_bb_sigs = generate_bb_signals(btc_df, long_only=False)
    btc_bb_tester = CustomBacktester(btc_df, market_type="crypto")
    eq_net, eq_gross, trades = btc_bb_tester.run_simulation(btc_bb_sigs, long_only=False)
    btc_bb_metrics = btc_bb_tester.compute_metrics(eq_net, eq_gross, trades)
    results.append(("BTCUSDT", "Bollinger Bands (L/S)", btc_bb_metrics))
    plot_equity_and_drawdown(btc_df["Date"], eq_net, "Bollinger Bands L/S (BTC)", "crypto", "btc_bb_reversion.png")
    
    # Indian Equities (TCS) - Long Only
    tcs_bb_sigs = generate_bb_signals(tcs_df, long_only=True)
    tcs_bb_tester = CustomBacktester(tcs_df, market_type="indian_equities")
    eq_net, eq_gross, trades = tcs_bb_tester.run_simulation(tcs_bb_sigs, long_only=True)
    tcs_bb_metrics = tcs_bb_tester.compute_metrics(eq_net, eq_gross, trades)
    results.append(("TCS", "Bollinger Bands (Long-Only)", tcs_bb_metrics))
    plot_equity_and_drawdown(tcs_df["Date"], eq_net, "Bollinger Bands Long-Only (TCS)", "indian_equities", "tcs_bb_reversion.png")
    
    # ----------------------------------------------------
    # Baseline 3: Pairs Trading / Statistical Arbitrage
    # ----------------------------------------------------
    print("\n[*] Evaluating Strategy 3: Pairs Trading / Statistical Arbitrage...")
    # Crypto (BTC/ETH pair)
    pair_crypto_df, sigs_1, sigs_2 = generate_pairs_signals(btc_df, eth_df, long_only=False)
    # Backtest individual legs with 50% capital allocation
    bt_btc = CustomBacktester(btc_df, initial_capital=50000.0, market_type="crypto")
    eq_btc_net, eq_btc_gross, trades_btc = bt_btc.run_simulation(sigs_1, long_only=False)
    
    bt_eth = CustomBacktester(eth_df, initial_capital=50000.0, market_type="crypto")
    eq_eth_net, eq_eth_gross, trades_eth = bt_eth.run_simulation(sigs_2, long_only=False)
    
    # Combine portfolios
    combined_equity = eq_btc_net + eq_eth_net
    combined_equity_gross = eq_btc_gross + eq_eth_gross
    combined_trades = trades_btc + trades_eth
    
    # Compute metrics using BTC's timeline
    btc_pair_tester = CustomBacktester(btc_df, initial_capital=100000.0, market_type="crypto")
    btc_pair_metrics = btc_pair_tester.compute_metrics(combined_equity, combined_equity_gross, combined_trades)
    results.append(("BTC/ETH Pair", "Pairs Trading (L/S)", btc_pair_metrics))
    plot_equity_and_drawdown(btc_df["Date"], combined_equity, "Pairs Trading (BTC/ETH)", "crypto", "btc_eth_pairs_trading.png")
    
    # Indian Equities (TCS/INFY pair)
    pair_indian_df, sigs_tcs, sigs_infy = generate_pairs_signals(tcs_df, infy_df, long_only=False)
    bt_tcs = CustomBacktester(tcs_df, initial_capital=50000.0, market_type="indian_equities")
    eq_tcs_net, eq_tcs_gross, trades_tcs = bt_tcs.run_simulation(sigs_tcs, long_only=False)
    
    bt_infy = CustomBacktester(infy_df, initial_capital=50000.0, market_type="indian_equities")
    eq_infy_net, eq_infy_gross, trades_infy = bt_infy.run_simulation(sigs_infy, long_only=False)
    
    combined_ind_equity = eq_tcs_net + eq_infy_net
    combined_ind_equity_gross = eq_tcs_gross + eq_infy_gross
    combined_ind_trades = trades_tcs + trades_infy
    
    ind_pair_tester = CustomBacktester(tcs_df, initial_capital=100000.0, market_type="indian_equities")
    ind_pair_metrics = ind_pair_tester.compute_metrics(combined_ind_equity, combined_ind_equity_gross, combined_ind_trades)
    results.append(("TCS/INFY Pair", "Pairs Trading (L/S)", ind_pair_metrics))
    plot_equity_and_drawdown(tcs_df["Date"], combined_ind_equity, "Pairs Trading (TCS/INFY)", "indian_equities", "tcs_infy_pairs_trading.png")
    
    # ----------------------------------------------------
    # Print Quantitative Summary Table
    # ----------------------------------------------------
    print("\n" + "="*90)
    print(f"{'Asset':<15} | {'Strategy':<25} | {'CAGR (%)':<10} | {'Vol (%)':<10} | {'Sharpe':<8} | {'MaxDD (%)':<10}")
    print("="*90)
    for asset, strat, m in results:
        print(f"{asset:<15} | {strat:<25} | {m['Annualized CAGR [%]']:<10.2f} | {m['Annualized Volatility [%]']:<10.2f} | {m['Sharpe Ratio']:<8.3f} | {m['Max Drawdown [%]']:<10.2f}")
    print("="*90 + "\n")
    
    # ----------------------------------------------------
    # Verification with backtesting.py
    # ----------------------------------------------------
    print("[*] Running cross-verification using official backtesting.py on BTCUSDT...")
    stats_sma = run_backtesting_py_comparison(btc_df, "SMA_Crossover")
    if stats_sma is not None:
        print(f"\n[+] backtesting.py SMA Crossover Result Summary:")
        print(f"    - Return [%]: {stats_sma['Return [%]']:.2f}%")
        print(f"    - Sharpe Ratio: {stats_sma['Sharpe Ratio']:.3f}")
        print(f"    - Max Drawdown [%]: {stats_sma['Max. Drawdown [%]']:.2f}%")
        print(f"    - Trade Count: {stats_sma['# Trades']}")
        
    stats_bb = run_backtesting_py_comparison(btc_df, "Bollinger_Bands")
    if stats_bb is not None:
        print(f"\n[+] backtesting.py Bollinger Bands Result Summary:")
        print(f"    - Return [%]: {stats_bb['Return [%]']:.2f}%")
        print(f"    - Sharpe Ratio: {stats_bb['Sharpe Ratio']:.3f}")
        print(f"    - Max Drawdown [%]: {stats_bb['Max. Drawdown [%]']:.2f}%")
        print(f"    - Trade Count: {stats_bb['# Trades']}\n")

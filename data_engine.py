import os
import requests
import pandas as pd
import numpy as np
from datetime import datetime

# Define directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

def fetch_binance_daily_data(symbol, start_date_str, end_date_str):
    """
    Fetches daily (1d) klines from Binance public API.
    """
    print(f"[*] Extracting historical stream for {symbol} from remote tape...")
    url = "https://api.binance.com/api/v3/klines"
    
    # Convert dates to millisecond timestamps
    start_dt = datetime.strptime(start_date_str, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date_str, "%Y-%m-%d")
    
    start_time = int(start_dt.timestamp() * 1000)
    end_time = int(end_dt.timestamp() * 1000)
    
    all_data = []
    current_start = start_time
    
    while current_start < end_time:
        params = {
            "symbol": symbol,
            "interval": "1d",
            "startTime": current_start,
            "endTime": end_time,
            "limit": 1000
        }
        
        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            print(f"[!] Error fetching data for {symbol}: {e}")
            break
            
        if not data:
            break
            
        all_data.extend(data)
        # Shift start time to the next candle (last timestamp + 1 ms)
        current_start = data[-1][6] + 1
        
        # Small sleep to prevent rate limiting
        import time
        time.sleep(0.1)
        
    if not all_data:
        print(f"[!] No data retrieved for {symbol}.")
        return None
        
    # Columns: Open time, Open, High, Low, Close, Volume, Close time...
    df = pd.DataFrame(all_data, columns=[
        "Open_Time", "Open", "High", "Low", "Close", "Volume",
        "Close_Time", "Quote_Asset_Volume", "Number_of_Trades",
        "Taker_Buy_Base", "Taker_Buy_Quote", "Ignore"
    ])
    
    # Process types and formats
    df["Date"] = pd.to_datetime(df["Open_Time"], unit="ms").dt.date
    for col in ["Open", "High", "Low", "Close", "Volume"]:
        df[col] = df[col].astype(float)
        
    df = df[["Date", "Open", "High", "Low", "Close", "Volume"]]
    df = df.sort_values("Date").drop_duplicates(subset=["Date"]).reset_index(drop=True)
    return df

def fetch_yfinance_data(ticker, start_date, end_date):
    """
    Fetches daily stock data using yfinance.
    """
    print(f"[*] Extracting historical stream for {ticker} from Yahoo Finance...")
    try:
        import yfinance as yf
        df = yf.download(ticker, start=start_date, end=end_date)
        if df.empty:
            return None
        df = df.reset_index()
        # Clean multi-index columns if yfinance returns them
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
            
        df = df.rename(columns={"Date": "Date", "Open": "Open", "High": "High", "Low": "Low", "Close": "Close", "Volume": "Volume"})
        df["Date"] = pd.to_datetime(df["Date"]).dt.date
        df = df[["Date", "Open", "High", "Low", "Close", "Volume"]]
        # Ensure floats
        for col in ["Open", "High", "Low", "Close", "Volume"]:
            df[col] = df[col].astype(float)
        return df
    except Exception as e:
        print(f"[!] Error downloading {ticker} via yfinance: {e}")
        return None

def run_eda(df, name):
    """
    Prints a basic EDA summary of the dataset.
    """
    if df is None or df.empty:
        print(f"[!] Cannot run EDA on empty DataFrame for {name}.")
        return
        
    # Calculate daily returns
    df = df.copy()
    df["Returns"] = df["Close"].pct_change()
    
    start_date = df["Date"].min()
    end_date = df["Date"].max()
    num_rows = len(df)
    
    mean_ret = df["Returns"].mean()
    vol_ret = df["Returns"].std() * np.sqrt(365 if "USDT" in name else 252) # Ann Volatility
    skewness = df["Returns"].skew()
    kurtosis = df["Returns"].kurt() # Excess kurtosis
    
    print(f"\n================ EDA NOTE: {name} ================")
    print(f"Coverage: {start_date} to {end_date} ({num_rows} bars)")
    print(f"Daily Return Mean: {mean_ret:.6f}")
    print(f"Annualized Volatility: {vol_ret:.4%}")
    print(f"Skewness: {skewness:.4f} (expected negative for equities, variable for crypto)")
    print(f"Excess Kurtosis: {kurtosis:.4f} (values > 0 indicate heavy/fat tails)")
    
    # Check for gaps (more than 1 day difference for equities on weekends/holidays)
    df["Date_diff"] = pd.to_datetime(df["Date"]).diff().dt.days
    if "USDT" in name:
        gaps = df[df["Date_diff"] > 1]
        if not gaps.empty:
            print(f"[!] Warning: Found {len(gaps)} gaps in continuous crypto data!")
        else:
            print("[+] Crypto Data Continuity: Gapless stream verified.")
    else:
        # Equities usually have 3 days difference over weekends, which is normal
        gaps = df[df["Date_diff"] > 3]
        if not gaps.empty:
            print(f"[!] Note: Found {len(gaps)} potential gaps > 3 days in Indian equities.")
        else:
            print("[+] Equities Data Continuity: Regular weekday trading verified.")
    print("==================================================\n")

if __name__ == "__main__":
    start_date = "2018-01-01"
    end_date = "2026-06-25"
    
    # 1. Fetch Crypto Assets
    crypto_symbols = ["BTCUSDT", "ETHUSDT"]
    for sym in crypto_symbols:
        df = fetch_binance_daily_data(sym, start_date, end_date)
        if df is not None:
            csv_path = os.path.join(DATA_DIR, f"{sym}_daily.csv")
            df.to_csv(csv_path, index=False)
            print(f"[+] Data cached securely at: {csv_path}")
            run_eda(df, sym)
            
    # 2. Fetch Indian Equities
    indian_symbols = ["TCS.NS", "INFY.NS"]
    for sym in indian_symbols:
        df = fetch_yfinance_data(sym, start_date, end_date)
        if df is not None:
            # Save file without the .NS for simplicity in backtester names
            clean_name = sym.split(".")[0]
            csv_path = os.path.join(DATA_DIR, f"{clean_name}_daily.csv")
            df.to_csv(csv_path, index=False)
            print(f"[+] Data cached securely at: {csv_path}")
            run_eda(df, clean_name)

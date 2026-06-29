from flask import Flask, request, jsonify, send_from_directory
import os
import pandas as pd
import numpy as np
from custom_backtester import CustomBacktester
from run_baselines import generate_sma_signals, generate_bb_signals, generate_pairs_signals, load_dataset

app = Flask(__name__, static_folder='static', static_url_path='')

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/status', methods=['GET'])
def status():
    return jsonify({
        "status": "healthy",
        "assets": ["BTCUSDT", "ETHUSDT", "TCS", "INFY"]
    })

@app.route('/api/backtest', methods=['POST'])
def backtest():
    data = request.json or {}
    
    asset = data.get("asset", "BTCUSDT")
    strategy = data.get("strategy", "SMA_Crossover")
    initial_capital = float(data.get("initial_capital", 100000.0))
    slippage_pct = float(data.get("slippage_pct", 0.05)) / 100.0  # Convert from % to ratio
    
    # Cost model selection
    market_type = 'indian_equities' if asset in ["TCS", "INFY"] else 'crypto'
    
    try:
        if strategy == "Pairs_Trading":
            # For Pairs Trading, load both legs
            if asset in ["BTCUSDT", "ETHUSDT"]:
                df1 = load_dataset("BTCUSDT")
                df2 = load_dataset("ETHUSDT")
            else:
                df1 = load_dataset("TCS")
                df2 = load_dataset("INFY")
                
            window = int(data.get("pairs_window", 60))
            entry_z = float(data.get("pairs_entry_z", 1.5))
            exit_z = float(data.get("pairs_exit_z", 0.0))
            
            m_df, sigs_1, sigs_2 = generate_pairs_signals(df1, df2, window=window, entry_z=entry_z, exit_z=exit_z, long_only=False)
            
            # Backtest both legs (50% capital each)
            bt1 = CustomBacktester(df1, initial_capital=initial_capital/2, market_type=market_type, slippage_pct=slippage_pct)
            eq1_net, eq1_gross, trades1 = bt1.run_simulation(sigs_1, long_only=False)
            
            bt2 = CustomBacktester(df2, initial_capital=initial_capital/2, market_type=market_type, slippage_pct=slippage_pct)
            eq2_net, eq2_gross, trades2 = bt2.run_simulation(sigs_2, long_only=False)
            
            combined_equity = eq1_net + eq2_net
            combined_equity_gross = eq1_gross + eq2_gross
            combined_trades = trades1 + trades2
            
            # Sort combined trades by Date
            combined_trades = sorted(combined_trades, key=lambda x: str(x['Date']))
            
            tester = CustomBacktester(df1, initial_capital=initial_capital, market_type=market_type, slippage_pct=slippage_pct)
            metrics = tester.compute_metrics(combined_equity, combined_equity_gross, combined_trades)
            
            dates = [str(d) for d in m_df['Date'].values]
            equity_curve = combined_equity.tolist()
            equity_curve_gross = combined_equity_gross.tolist()
            
            peaks = pd.Series(combined_equity).cummax()
            drawdowns = ((pd.Series(combined_equity) - peaks) / peaks * 100.0).tolist()
            
            price_series = df1['Close'].tolist()  # Reference asset
            trades_to_serialize = combined_trades
            
        else:
            df = load_dataset(asset)
            tester = CustomBacktester(df, initial_capital=initial_capital, market_type=market_type, slippage_pct=slippage_pct)
            
            if strategy == "SMA_Crossover":
                fast = int(data.get("sma_fast", 50))
                slow = int(data.get("sma_slow", 200))
                signals = generate_sma_signals(df, fast=fast, slow=slow)
                eq_net, eq_gross, trades = tester.run_simulation(signals, long_only=True)
                
            elif strategy == "Bollinger_Bands":
                period = int(data.get("bb_period", 20))
                num_std = float(data.get("bb_std", 2.0))
                long_only = data.get("bb_long_only", "true").lower() == "true"
                signals = generate_bb_signals(df, period=period, num_std=num_std, long_only=long_only)
                eq_net, eq_gross, trades = tester.run_simulation(signals, long_only=long_only)
                
            metrics = tester.compute_metrics(eq_net, eq_gross, trades)
            dates = [str(d) for d in df['Date'].values]
            equity_curve = eq_net.tolist()
            equity_curve_gross = eq_gross.tolist()
            
            peaks = pd.Series(eq_net).cummax()
            drawdowns = ((pd.Series(eq_net) - peaks) / peaks * 100.0).tolist()
            
            price_series = df['Close'].tolist()
            trades_to_serialize = trades
            
        # Format trades to be JSON serializable
        serializable_trades = []
        for t in trades_to_serialize:
            t_copy = t.copy()
            t_copy['Date'] = str(t_copy['Date'])
            serializable_trades.append(t_copy)
            
        return jsonify({
            "success": True,
            "metrics": metrics,
            "series": {
                "dates": dates,
                "equity_curve": equity_curve,
                "equity_curve_gross": equity_curve_gross,
                "drawdowns": drawdowns,
                "asset_prices": price_series
            },
            "trades": serializable_trades
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)

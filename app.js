document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("backtest-form");
    const strategySelect = document.getElementById("strategy");
    const assetSelect = document.getElementById("asset");
    const marketBadge = document.getElementById("market-badge");
    const marketTypeLabel = document.getElementById("market-type-label");
    const btnText = document.getElementById("btn-text");
    
    // Strategy block elements
    const paramSma = document.getElementById("param-sma");
    const paramBb = document.getElementById("param-bb");
    const paramPairs = document.getElementById("param-pairs");
    
    let equityChart = null;
    let drawdownChart = null;
    
    // Toggle configuration sections based on strategy choice
    strategySelect.addEventListener("change", (e) => {
        const strat = e.target.value;
        paramSma.classList.add("hidden");
        paramBb.classList.add("hidden");
        paramPairs.classList.add("hidden");
        
        if (strat === "SMA_Crossover") {
            paramSma.classList.remove("hidden");
        } else if (strat === "Bollinger_Bands") {
            paramBb.classList.remove("hidden");
        } else if (strat === "Pairs_Trading") {
            paramPairs.classList.remove("hidden");
        }
    });
    
    assetSelect.addEventListener("change", (e) => {
        updateMarketBadge(e.target.value);
    });
    
    function updateMarketBadge(asset) {
        if (asset === "TCS" || asset === "INFY") {
            marketTypeLabel.textContent = "NSE Indian Equities Frictions Model";
            marketBadge.style.backgroundColor = "rgba(47, 128, 237, 0.1)";
            marketBadge.style.borderColor = "rgba(47, 128, 237, 0.3)";
            marketBadge.style.color = "#2f80ed";
        } else {
            marketTypeLabel.textContent = "Binance Crypto Cost Model";
            marketBadge.style.backgroundColor = "rgba(0, 229, 255, 0.1)";
            marketBadge.style.borderColor = "rgba(0, 229, 255, 0.3)";
            marketBadge.style.color = "#00e5ff";
        }
    }

    // Helper functions for Technical Analysis Indicators in JS
    function calculateSMA(data, period) {
        let sma = new Array(data.length).fill(null);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i];
            if (i >= period - 1) {
                if (i >= period) {
                    sum -= data[i - period];
                }
                sma[i] = sum / period;
            }
        }
        return sma;
    }

    function calculateRollingStd(data, sma, period) {
        let std = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            let variance = 0;
            let mean = sma[i];
            for (let j = i - period + 1; j <= i; j++) {
                variance += Math.pow(data[j] - mean, 2);
            }
            std[i] = Math.sqrt(variance / period);
        }
        return std;
    }

    function generateSmaSignals(df, fast, slow) {
        let closes = df.map(r => r.Close);
        let fastSma = calculateSMA(closes, fast);
        let slowSma = calculateSMA(closes, slow);
        
        let signals = new Array(df.length).fill(0);
        for (let i = 0; i < df.length; i++) {
            if (fastSma[i] === null || slowSma[i] === null) {
                signals[i] = 0;
            } else {
                signals[i] = fastSma[i] > slowSma[i] ? 1.0 : 0.0;
            }
        }
        return signals;
    }

    function generateBbSignals(df, period, numStd, longOnly) {
        let closes = df.map(r => r.Close);
        let sma = calculateSMA(closes, period);
        let std = calculateRollingStd(closes, sma, period);
        
        let signals = new Array(df.length).fill(0);
        let pos = 0;
        for (let i = 0; i < df.length; i++) {
            if (sma[i] === null || std[i] === null) {
                signals[i] = 0;
                continue;
            }
            let c = closes[i];
            let lower = sma[i] - numStd * std[i];
            let upper = sma[i] + numStd * std[i];
            let middle = sma[i];
            
            if (pos === 0) {
                if (c < lower) {
                    pos = 1;
                } else if (c > upper && !longOnly) {
                    pos = -1;
                }
            } else if (pos === 1) { // Long
                if (c >= middle) {
                    pos = 0;
                }
            } else if (pos === -1) { // Short
                if (c <= middle) {
                    pos = 0;
                }
            }
            signals[i] = pos;
        }
        return signals;
    }

    // Client-side CSV Loader using PapaParse
    async function loadCSV(asset) {
        // Relative URL for GitHub pages or local dev server compatibility
        const path = `./data/${asset}_daily.csv`;
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to fetch CSV file from ${path}. Status: ${response.status} (${response.statusText})`);
        }
        const text = await response.text();
        
        return new Promise((resolve, reject) => {
            Papa.parse(text, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: function(results) {
                    let df = results.data.filter(row => row.Date != null && row.Close != null);
                    if (df.length === 0) {
                        reject(new Error("Parsed CSV dataset is empty. Check if the file format is correct."));
                        return;
                    }
                    // Ensure columns are floats and sorted
                    df.forEach(row => {
                        row.Open = parseFloat(row.Open);
                        row.High = parseFloat(row.High);
                        row.Low = parseFloat(row.Low);
                        row.Close = parseFloat(row.Close);
                        row.Volume = parseFloat(row.Volume);
                    });
                    df.sort((a, b) => new Date(a.Date) - new Date(b.Date));
                    resolve(df);
                },
                error: function(err) {
                    reject(err);
                }
            });
        });
    }

    // JS Implementation of Custom Simulator (aligning with Python logic)
    class JsBacktestEngine {
        constructor(df, initialCapital, marketType, slippagePct) {
            this.df = df;
            this.initialCapital = initialCapital;
            this.marketType = marketType;
            this.slippagePct = slippagePct;
        }

        calculateCryptoFees(tradeValue) {
            return 0.001 * tradeValue;
        }

        calculateIndianFees(tradeValue, isBuy) {
            let brokerage = Math.min(0.0003 * tradeValue, 20.0);
            let stt = 0.001 * tradeValue;
            let exchangeCharges = 0.0000345 * tradeValue;
            let sebiFee = 0.000001 * tradeValue;
            let gst = 0.18 * (brokerage + exchangeCharges + sebiFee);
            let stampDuty = isBuy ? 0.00015 * tradeValue : 0.0;
            return brokerage + stt + exchangeCharges + sebiFee + gst + stampDuty;
        }

        runSimulation(signals, longOnly) {
            // Enforce strict 1-bar execution delay
            let execSignals = new Array(signals.length).fill(0);
            for (let i = 1; i < signals.length; i++) {
                execSignals[i] = signals[i - 1];
            }

            let cash = this.initialCapital;
            let position = 0.0;

            let cashGross = this.initialCapital;
            let positionGross = 0.0;

            let equityNet = new Array(this.df.length).fill(this.initialCapital);
            let equityGross = new Array(this.df.length).fill(this.initialCapital);
            let trades = [];

            for (let i = 0; i < this.df.length; i++) {
                let openPrice = this.df[i].Open;
                let closePrice = this.df[i].Close;
                let targetWeight = execSignals[i];

                if (longOnly && targetWeight < 0) {
                    targetWeight = 0.0;
                }

                let currentEquity = cash + position * openPrice;
                let currentEquityGross = cashGross + positionGross * openPrice;

                let currentWeight = currentEquity > 0 ? (position * openPrice) / currentEquity : 0.0;
                let currentWeightGross = currentEquityGross > 0 ? (positionGross * openPrice) / currentEquityGross : 0.0;

                // Rebalance Net Portfolio (with fees and slippage)
                if (targetWeight !== currentWeight) {
                    let targetValue = targetWeight * currentEquity;
                    let currentValue = position * openPrice;
                    let tradeValue = targetValue - currentValue;

                    if (tradeValue > 0) { // BUY
                        let buyPrice = openPrice * (1 + this.slippagePct);
                        let approxFeeRate = this.marketType === 'crypto' ? 0.001 : 0.0015;
                        let maxBuyValue = cash / (1 + approxFeeRate);
                        let actualTradeValue = Math.min(tradeValue, maxBuyValue);

                        if (actualTradeValue > 0) {
                            let sharesToBuy = actualTradeValue / buyPrice;
                            let grossCost = sharesToBuy * buyPrice;
                            let fees = this.marketType === 'crypto' ? 
                                       this.calculateCryptoFees(grossCost) : 
                                       this.calculateIndianFees(grossCost, true);

                            if (cash - (grossCost + fees) < 0) {
                                let scale = cash / (grossCost + fees);
                                sharesToBuy *= scale * 0.999;
                                grossCost = sharesToBuy * buyPrice;
                                fees = this.marketType === 'crypto' ? 
                                       this.calculateCryptoFees(grossCost) : 
                                       this.calculateIndianFees(grossCost, true);
                            }

                            cash = cash - grossCost - fees;
                            position += sharesToBuy;
                            trades.push({
                                Date: this.df[i].Date,
                                Type: "BUY",
                                Price: buyPrice,
                                Units: sharesToBuy,
                                Value: grossCost,
                                Fees: fees,
                                Cash_After: cash
                            });
                        }
                    } else if (tradeValue < 0) { // SELL
                        let sellPrice = openPrice * (1 - this.slippagePct);
                        let sharesToSell = Math.abs(tradeValue) / sellPrice;

                        if (longOnly) {
                            sharesToSell = Math.min(sharesToSell, position);
                        }

                        if (sharesToSell > 0) {
                            let grossRevenue = sharesToSell * sellPrice;
                            let fees = this.marketType === 'crypto' ? 
                                       this.calculateCryptoFees(grossRevenue) : 
                                       this.calculateIndianFees(grossRevenue, false);

                            cash = cash + grossRevenue - fees;
                            position -= sharesToSell;
                            trades.push({
                                Date: this.df[i].Date,
                                Type: "SELL",
                                Price: sellPrice,
                                Units: sharesToSell,
                                Value: grossRevenue,
                                Fees: fees,
                                Cash_After: cash
                            });
                        }
                    }
                }

                // Rebalance Gross Portfolio (zero fees/slippage)
                if (targetWeight !== currentWeightGross) {
                    let targetValueGross = targetWeight * currentEquityGross;
                    let currentValueGross = positionGross * openPrice;
                    let tradeValueGross = targetValueGross - currentValueGross;

                    if (tradeValueGross > 0) {
                        let sharesToBuy = tradeValueGross / openPrice;
                        cashGross -= sharesToBuy * openPrice;
                        positionGross += sharesToBuy;
                    } else if (tradeValueGross < 0) {
                        let sharesToSell = Math.abs(tradeValueGross) / openPrice;
                        if (longOnly) {
                            sharesToSell = Math.min(sharesToSell, positionGross);
                        }
                        cashGross += sharesToSell * openPrice;
                        positionGross -= sharesToSell;
                    }
                }

                // Value portfolio at close of bar
                equityNet[i] = cash + position * closePrice;
                equityGross[i] = cashGross + positionGross * closePrice;
            }

            return { equityNet, equityGross, trades };
        }

        computeMetrics(equityNet, equityGross, trades) {
            let n = equityNet.length;
            let finalVal = equityNet[n - 1];
            let initialVal = equityNet[0];

            let totalReturn = (finalVal / initialVal) - 1;
            let totalReturnGross = (equityGross[n - 1] / equityGross[0]) - 1;
            let costDrag = totalReturnGross - totalReturn;

            let startDt = new Date(this.df[0].Date);
            let endDt = new Date(this.df[n - 1].Date);
            let years = (endDt - startDt) / (1000 * 60 * 60 * 24 * 365.25);
            let annFactor = this.marketType === 'crypto' ? 365.25 : 252.0;
            if (years <= 0) {
                years = n / annFactor;
            }

            let cagr = years > 0 && finalVal > 0 ? Math.pow(finalVal / initialVal, 1 / years) - 1 : 0;

            let dailyReturns = [];
            for (let i = 1; i < n; i++) {
                dailyReturns.push((equityNet[i] / equityNet[i - 1]) - 1);
            }

            // Standard deviation and annualized volatility
            let meanRet = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
            let varRet = dailyReturns.length > 1 ? dailyReturns.reduce((a, b) => a + Math.pow(b - meanRet, 2), 0) / (dailyReturns.length - 1) : 0;
            let vol = Math.sqrt(varRet * annFactor);

            // Sharpe
            let sharpe = vol > 0 ? (meanRet / Math.sqrt(varRet)) * Math.sqrt(annFactor) : 0;

            // Sortino
            let negativeReturns = dailyReturns.filter(r => r < 0);
            let sortino = 0;
            if (negativeReturns.length > 1) {
                let varNeg = negativeReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / negativeReturns.length;
                let downsideVol = Math.sqrt(varNeg * annFactor);
                sortino = downsideVol > 0 ? (meanRet / Math.sqrt(varNeg)) * Math.sqrt(annFactor) : 0;
            }

            // Max Drawdown
            let maxPeak = 0;
            let maxDd = 0;
            for (let i = 0; i < n; i++) {
                if (equityNet[i] > maxPeak) {
                    maxPeak = equityNet[i];
                }
                let dd = maxPeak > 0 ? (equityNet[i] - maxPeak) / maxPeak : 0;
                if (dd < maxDd) {
                    maxDd = dd;
                }
            }

            // Hit rate from trades list
            let wins = 0;
            let losses = 0;
            let entryPrice = 0;
            let entryUnits = 0;
            let entryType = "";

            trades.forEach(t => {
                if (entryUnits === 0) {
                    entryPrice = t.Price;
                    entryUnits = t.Units;
                    entryType = t.Type;
                } else {
                    let exitPrice = t.Price;
                    let ret = entryType === "BUY" ? (exitPrice / entryPrice) - 1 : (entryPrice / exitPrice) - 1;
                    if (ret > 0) wins++;
                    else losses++;
                    entryUnits = 0;
                }
            });

            let totalTrades = wins + losses;
            let hitRate = totalTrades > 0 ? wins / totalTrades : 0;

            return {
                cagr: cagr * 100,
                volatility: vol * 100,
                sharpe: sharpe,
                sortino: sortino,
                maxDd: maxDd * 100,
                hitRate: hitRate * 100,
                costDrag: costDrag * 100
            };
        }
    }

    // Form submit listener
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        btnText.textContent = "Simulating...";
        const submitBtn = form.querySelector("button[type='submit']");
        submitBtn.disabled = true;

        const asset = document.getElementById("asset").value;
        const strategy = strategySelect.value;
        const initialCapital = parseFloat(document.getElementById("initial_capital").value);
        const slippagePct = parseFloat(document.getElementById("slippage_pct").value) / 100.0;
        
        const marketType = (asset === "TCS" || asset === "INFY") ? 'indian_equities' : 'crypto';
        
        try {
            let df = [];
            let signals = [];
            let equityNet = [];
            let equityGross = [];
            let trades = [];
            let dates = [];
            let assetPrices = [];

            if (strategy === "Pairs_Trading") {
                let df1, df2;
                if (asset === "BTCUSDT" || asset === "ETHUSDT") {
                    df1 = await loadCSV("BTCUSDT");
                    df2 = await loadCSV("ETHUSDT");
                } else {
                    df1 = await loadCSV("TCS");
                    df2 = await loadCSV("INFY");
                }

                // Align datasets on Date
                let map2 = {};
                df2.forEach(row => { map2[row.Date] = row; });
                
                let aligned = [];
                df1.forEach(row1 => {
                    if (map2[row1.Date]) {
                        aligned.push({
                            Date: row1.Date,
                            Open_1: row1.Open,
                            Close_1: row1.Close,
                            Open_2: map2[row1.Date].Open,
                            Close_2: map2[row1.Date].Close
                        });
                    }
                });
                aligned.sort((a, b) => new Date(a.Date) - new Date(b.Date));

                const window = parseInt(document.getElementById("pairs_window").value);
                const entryZ = parseFloat(document.getElementById("pairs_entry_z").value);
                const exitZ = parseFloat(document.getElementById("pairs_exit_z").value);

                // Compute Pairs z-scores and signals
                let N = aligned.length;
                let zScores = new Array(N).fill(0);
                let close1 = aligned.map(r => r.Close_1);
                let close2 = aligned.map(r => r.Close_2);

                for (let i = window; i < N; i++) {
                    let x = close1.slice(i - window, i);
                    let y = close2.slice(i - window, i);
                    let meanX = x.reduce((a, b) => a + b, 0) / window;
                    let meanY = y.reduce((a, b) => a + b, 0) / window;
                    
                    let num = 0, den = 0;
                    for (let j = 0; j < window; j++) {
                        num += (x[j] - meanX) * (y[j] - meanY);
                        den += Math.pow(x[j] - meanX, 2);
                    }
                    let beta = den > 0 ? num / den : 0;
                    let alpha = meanY - beta * meanX;

                    let spreads = [];
                    for (let j = i - window; j < i; j++) {
                        spreads.push(close2[j] - (beta * close1[j] + alpha));
                    }
                    let meanSpread = spreads.reduce((a, b) => a + b, 0) / window;
                    let varSpread = spreads.reduce((a, b) => a + Math.pow(b - meanSpread, 2), 0) / window;
                    let stdSpread = Math.sqrt(varSpread);

                    let currentSpread = close2[i] - (beta * close1[i] + alpha);
                    zScores[i] = stdSpread > 0 ? (currentSpread - meanSpread) / stdSpread : 0;
                }

                let sigs1 = new Array(N).fill(0);
                let sigs2 = new Array(N).fill(0);
                let pos = 0;

                for (let i = window; i < N; i++) {
                    let z = zScores[i];
                    if (pos === 0) {
                        if (z < -entryZ) pos = 1;
                        else if (z > entryZ) pos = -1;
                    } else if (pos === 1) {
                        if (z >= exitZ) pos = 0;
                    } else if (pos === -1) {
                        if (z <= exitZ) pos = 0;
                    }

                    if (pos === 1) {
                        sigs2[i] = 0.5;
                        sigs1[i] = -0.5;
                    } else if (pos === -1) {
                        sigs2[i] = -0.5;
                        sigs1[i] = 0.5;
                    }
                }

                // Simulate both legs
                // Leg 1 (Asset 1)
                let mockDf1 = aligned.map(r => ({ Date: r.Date, Open: r.Open_1, Close: r.Close_1 }));
                let bt1 = new JsBacktestEngine(mockDf1, initialCapital / 2, marketType, slippagePct);
                let res1 = bt1.runSimulation(sigs1, false);

                // Leg 2 (Asset 2)
                let mockDf2 = aligned.map(r => ({ Date: r.Date, Open: r.Open_2, Close: r.Close_2 }));
                let bt2 = new JsBacktestEngine(mockDf2, initialCapital / 2, marketType, slippagePct);
                let res2 = bt2.runSimulation(sigs2, false);

                // Combine curves
                for (let i = 0; i < N; i++) {
                    equityNet.push(res1.equityNet[i] + res2.equityNet[i]);
                    equityGross.push(res1.equityGross[i] + res2.equityGross[i]);
                }
                trades = [...res1.trades, ...res2.trades].sort((a, b) => new Date(a.Date) - new Date(b.Date));

                dates = aligned.map(r => r.Date);
                assetPrices = aligned.map(r => r.Close_1); // Use Asset 1 as price reference

                let combinedEngine = new JsBacktestEngine(mockDf1, initialCapital, marketType, slippagePct);
                let metrics = combinedEngine.computeMetrics(equityNet, equityGross, trades);
                
                updateDashboard(metrics, equityNet, equityGross, trades, dates, assetPrices, marketType);

            } else {
                df = await loadCSV(asset);
                const engine = new JsBacktestEngine(df, initialCapital, marketType, slippagePct);

                if (strategy === "SMA_Crossover") {
                    const fast = parseInt(document.getElementById("sma_fast").value);
                    const slow = parseInt(document.getElementById("sma_slow").value);
                    signals = generateSmaSignals(df, fast, slow);
                    let res = engine.runSimulation(signals, true);
                    equityNet = res.equityNet;
                    equityGross = res.equityGross;
                    trades = res.trades;
                } else if (strategy === "Bollinger_Bands") {
                    const period = parseInt(document.getElementById("bb_period").value);
                    const numStd = parseFloat(document.getElementById("bb_std").value);
                    const longOnly = document.getElementById("bb_long_only").checked;
                    signals = generateBbSignals(df, period, numStd, longOnly);
                    let res = engine.runSimulation(signals, longOnly);
                    equityNet = res.equityNet;
                    equityGross = res.equityGross;
                    trades = res.trades;
                }

                dates = df.map(r => r.Date);
                assetPrices = df.map(r => r.Close);

                let metrics = engine.computeMetrics(equityNet, equityGross, trades);
                updateDashboard(metrics, equityNet, equityGross, trades, dates, assetPrices, marketType);
            }

        } catch (err) {
            console.error("Simulation failed:", err);
            alert("Simulation failed: " + err.message);
        } finally {
            btnText.textContent = "Run Backtest";
            submitBtn.disabled = false;
        }
    });

    function updateDashboard(metrics, equityNet, equityGross, trades, dates, assetPrices, marketType) {
        // Update Market Badge
        updateMarketBadge(assetSelect.value);
        
        // Update KPIs
        document.getElementById("val-cagr").textContent = metrics.cagr.toFixed(2) + "%";
        document.getElementById("val-sharpe").textContent = metrics.sharpe.toFixed(2);
        document.getElementById("val-sortino").textContent = metrics.sortino.toFixed(2);
        document.getElementById("val-maxdd").textContent = metrics.maxDd.toFixed(2) + "%";
        document.getElementById("val-hitrate").textContent = metrics.hitRate.toFixed(2) + "%";
        document.getElementById("val-drag").textContent = metrics.costDrag.toFixed(2) + "%";
        
        // Color coding KPIs
        const cagrCard = document.getElementById("card-cagr");
        const sharpeCard = document.getElementById("card-sharpe");
        
        if (metrics.cagr >= 0) {
            cagrCard.classList.remove("negative");
            document.getElementById("val-cagr").style.color = "var(--accent-green)";
        } else {
            cagrCard.classList.add("negative");
            document.getElementById("val-cagr").style.color = "var(--accent-red)";
        }
        
        if (metrics.sharpe >= 0) {
            sharpeCard.classList.remove("negative");
            document.getElementById("val-sharpe").style.color = "var(--accent-cyan)";
        } else {
            sharpeCard.classList.add("negative");
            document.getElementById("val-sharpe").style.color = "var(--accent-red)";
        }
        
        // Render Chart.js plots
        renderCharts(dates, equityNet, equityGross, assetPrices, parseFloat(document.getElementById("initial_capital").value));
        
        // Render table logs
        renderTradesTable(trades);
    }

    function renderCharts(dates, equityNet, equityGross, assetPrices, initialCapital) {
        // Normalize Buy & Hold Asset Prices
        const basePrice = assetPrices[0];
        const bhBenchmark = assetPrices.map(p => (p / basePrice) * initialCapital);
        
        // 1. Equity Chart
        if (equityChart) {
            equityChart.destroy();
        }
        
        const ctxEquity = document.getElementById("equityChart").getContext("2d");
        equityChart = new Chart(ctxEquity, {
            type: "line",
            data: {
                labels: dates,
                datasets: [
                    {
                        label: "Net Portfolio Value (Realized)",
                        data: equityNet,
                        borderColor: "#00e5ff",
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: "Gross Portfolio Value (No Fees)",
                        data: equityGross,
                        borderColor: "#2f80ed",
                        borderWidth: 1.5,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        borderDash: [5, 5]
                    },
                    {
                        label: "Buy & Hold Benchmark (Gross)",
                        data: bhBenchmark,
                        borderColor: "rgba(139, 148, 158, 0.4)",
                        borderWidth: 1.5,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#161b22",
                        titleColor: "#f0f6fc",
                        bodyColor: "#f0f6fc",
                        borderColor: "#30363d",
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { color: "#21262d" }, ticks: { color: "#8b949e", maxTicksLimit: 12 } },
                    y: {
                        grid: { color: "#21262d" },
                        ticks: {
                            color: "#8b949e",
                            callback: function(value) { return "$" + value.toLocaleString(); }
                        }
                    }
                }
            }
        });
        
        // 2. Drawdowns Chart
        let drawdowns = [];
        let maxPeak = 0;
        for (let i = 0; i < equityNet.length; i++) {
            if (equityNet[i] > maxPeak) maxPeak = equityNet[i];
            drawdowns.push(maxPeak > 0 ? ((equityNet[i] - maxPeak) / maxPeak) * 100 : 0);
        }

        if (drawdownChart) {
            drawdownChart.destroy();
        }
        
        const ctxDrawdown = document.getElementById("drawdownChart").getContext("2d");
        drawdownChart = new Chart(ctxDrawdown, {
            type: "line",
            data: {
                labels: dates,
                datasets: [
                    {
                        label: "Drawdown (%)",
                        data: drawdowns,
                        borderColor: "#ff1744",
                        backgroundColor: "rgba(255, 23, 68, 0.15)",
                        borderWidth: 1.5,
                        fill: true,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: "#161b22",
                        titleColor: "#f0f6fc",
                        bodyColor: "#f0f6fc",
                        borderColor: "#30363d",
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) { return `Drawdown: ${context.parsed.y.toFixed(2)}%`; }
                        }
                    }
                },
                scales: {
                    x: { grid: { color: "#21262d" }, ticks: { color: "#8b949e", maxTicksLimit: 12 } },
                    y: {
                        grid: { color: "#21262d" },
                        ticks: { color: "#8b949e", callback: function(value) { return value.toFixed(1) + "%"; } },
                        max: 0
                    }
                }
            }
        });
    }

    function renderTradesTable(trades) {
        const body = document.getElementById("trades-body");
        const countSpan = document.getElementById("trades-count");
        
        body.innerHTML = "";
        countSpan.textContent = `${trades.length} Trades Executed`;
        
        if (trades.length === 0) {
            body.innerHTML = `<tr><td colspan="7" class="empty-state">Strategy generated 0 trades over this timeframe.</td></tr>`;
            return;
        }
        
        // Show newest trades first
        const sortedTrades = [...trades].reverse();
        
        sortedTrades.forEach(t => {
            const row = document.createElement("tr");
            const badgeClass = t.Type === "BUY" ? "badge buy" : "badge sell";
            
            row.innerHTML = `
                <td>${t.Date}</td>
                <td><span class="${badgeClass}">${t.Type}</span></td>
                <td>$${t.Price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td>${t.Units.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}</td>
                <td>$${t.Value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td>$${t.Fees.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td>$${t.Cash_After.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            `;
            body.appendChild(row);
        });
    }

    // Trigger initial simulation load on page open
    form.dispatchEvent(new Event("submit"));
});

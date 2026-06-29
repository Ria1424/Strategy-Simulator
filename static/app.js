document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("backtest-form");
    const strategySelect = document.getElementById("strategy");
    const assetSelect = document.getElementById("asset");
    const marketBadge = document.getElementById("market-badge");
    const marketTypeLabel = document.getElementById("market-type-label");
    const btnText = document.getElementById("btn-text");
    
    // Strategy parameter blocks
    const paramSma = document.getElementById("param-sma");
    const paramBb = document.getElementById("param-bb");
    const paramPairs = document.getElementById("param-pairs");
    
    let equityChart = null;
    let drawdownChart = null;
    
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
    
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        btnText.textContent = "Running...";
        const submitBtn = form.querySelector("button[type='submit']");
        submitBtn.disabled = true;
        
        const payload = {
            asset: document.getElementById("asset").value,
            strategy: strategySelect.value,
            initial_capital: parseFloat(document.getElementById("initial_capital").value),
            slippage_pct: parseFloat(document.getElementById("slippage_pct").value),
            
            sma_fast: parseInt(document.getElementById("sma_fast").value),
            sma_slow: parseInt(document.getElementById("sma_slow").value),
            
            bb_period: parseInt(document.getElementById("bb_period").value),
            bb_std: parseFloat(document.getElementById("bb_std").value),
            bb_long_only: document.getElementById("bb_long_only").checked ? "true" : "false",
            
            pairs_window: parseInt(document.getElementById("pairs_window").value),
            pairs_entry_z: parseFloat(document.getElementById("pairs_entry_z").value),
            pairs_exit_z: parseFloat(document.getElementById("pairs_exit_z").value)
        };
        
        try {
            const response = await fetch("/api/backtest", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });
            
            const result = await response.json();
            
            if (result.success) {
                updateDashboard(result, payload);
            } else {
                alert("Error running backtest: " + result.error);
            }
        } catch (err) {
            console.error("Backtest failed:", err);
            alert("Network error. Make sure the Flask server is running.");
        } finally {
            btnText.textContent = "Run Backtest";
            submitBtn.disabled = false;
        }
    });
    
    function updateDashboard(data, payload) {
        const metrics = data.metrics;
        const series = data.series;
        const trades = data.trades;
        
        updateMarketBadge(payload.asset);
        
        // Update KPIs
        document.getElementById("val-cagr").textContent = metrics["Annualized CAGR [%]"].toFixed(2) + "%";
        document.getElementById("val-sharpe").textContent = metrics["Sharpe Ratio"].toFixed(2);
        document.getElementById("val-sortino").textContent = metrics["Sortino Ratio"].toFixed(2);
        document.getElementById("val-maxdd").textContent = metrics["Max Drawdown [%]"].toFixed(2) + "%";
        document.getElementById("val-hitrate").textContent = metrics["Hit Rate [%]"].toFixed(2) + "%";
        document.getElementById("val-drag").textContent = metrics["Cost Drag [%]"].toFixed(2) + "%";
        
        const cagrCard = document.getElementById("card-cagr");
        const sharpeCard = document.getElementById("card-sharpe");
        
        if (metrics["Annualized CAGR [%]"] >= 0) {
            cagrCard.classList.remove("negative");
            document.getElementById("val-cagr").style.color = "var(--accent-green)";
        } else {
            cagrCard.classList.add("negative");
            document.getElementById("val-cagr").style.color = "var(--accent-red)";
        }
        
        if (metrics["Sharpe Ratio"] >= 0) {
            sharpeCard.classList.remove("negative");
            document.getElementById("val-sharpe").style.color = "var(--accent-cyan)";
        } else {
            sharpeCard.classList.add("negative");
            document.getElementById("val-sharpe").style.color = "var(--accent-red)";
        }
        
        renderCharts(series, payload.initial_capital);
        renderTradesTable(trades);
    }
    
    function renderCharts(series, initialCapital) {
        const dates = series.dates;
        const equityNet = series.equity_curve;
        const equityGross = series.equity_curve_gross;
        const drawdowns = series.drawdowns;
        const assetPrices = series.asset_prices;
        
        const basePrice = assetPrices[0];
        const bhBenchmark = assetPrices.map(p => (p / basePrice) * initialCapital);
        
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
                interaction: {
                    mode: "index",
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: "#161b22",
                        titleColor: "#f0f6fc",
                        bodyColor: "#f0f6fc",
                        borderColor: "#30363d",
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: "#21262d"
                        },
                        ticks: {
                            color: "#8b949e",
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        grid: {
                            color: "#21262d"
                        },
                        ticks: {
                            color: "#8b949e",
                            callback: function(value) {
                                return "$" + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
        
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
                interaction: {
                    mode: "index",
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: "#161b22",
                        titleColor: "#f0f6fc",
                        bodyColor: "#f0f6fc",
                        borderColor: "#30363d",
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return `Drawdown: ${context.parsed.y.toFixed(2)}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: "#21262d"
                        },
                        ticks: {
                            color: "#8b949e",
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        grid: {
                            color: "#21262d"
                        },
                        ticks: {
                            color: "#8b949e",
                            callback: function(value) {
                                return value.toFixed(1) + "%";
                            }
                        },
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
    
    form.dispatchEvent(new Event("submit"));
});

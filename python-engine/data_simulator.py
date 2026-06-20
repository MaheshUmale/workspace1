"""
Data Simulator — Realistic Indian Market Data Simulation Engine
===============================================================
Generates deterministic, realistic market data for NIFTY and BANKNIFTY
including spot prices (GBM), option chains (Black-Scholes), OI patterns,
7-Strike COI PCR matrix, signal generation, trade suggestions, volume
proxy, and trap cluster detection.

Matches the TypeScript MarketSimulator functionality exactly.
"""

import math
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from config import (
    RISK_FREE_RATE,
    UNDERLYING_CONFIG,
    TIMEFRAME_MAP,
)

# ============ Seeded PRNG (Mulberry32) ============


def mulberry32(seed: int):
    """Deterministic pseudo-random number generator (Mulberry32).
    Returns a function that produces floats in [0, 1)."""
    s = seed & 0xFFFFFFFF

    def _rng() -> float:
        nonlocal s
        s = (s + 0x6D2B79F5) & 0xFFFFFFFF
        t = s ^ (s >> 15)
        t = (t * (1 | s)) & 0xFFFFFFFF
        t = (t + (t * (61 | t) & 0xFFFFFFFF)) & 0xFFFFFFFF
        t = t ^ (t >> 14)
        return (t & 0xFFFFFFFF) / 4294967296.0

    return _rng


# ============ Normal distribution (Box-Muller) ============


def normal_random(rng, mean: float = 0.0, std: float = 1.0) -> float:
    """Generate a normally-distributed random number using Box-Muller transform."""
    u1 = rng()
    u2 = rng()
    z = math.sqrt(-2.0 * math.log(u1 if u1 > 0 else 1e-10)) * math.cos(
        2.0 * math.pi * u2
    )
    return z * std + mean


# ============ Cumulative Normal Distribution (Abramowitz & Stegun) ============


def cdf(x: float) -> float:
    """Standard normal cumulative distribution function.
    Uses the Abramowitz & Stegun approximation for speed."""
    a1 = 0.254829592
    a2 = -0.284496736
    a3 = 1.421413741
    a4 = -1.453152027
    a5 = 1.061405429
    p = 0.3275911

    sign = -1.0 if x < 0 else 1.0
    x = abs(x) / math.sqrt(2.0)

    t = 1.0 / (1.0 + p * x)
    y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * math.exp(
        -x * x
    )
    return 0.5 * (1.0 + sign * y)


def ndist(x: float) -> float:
    """Standard normal probability density function."""
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


# ============ Helper functions ============


def next_thursdays(count: int) -> List[datetime]:
    """Return the next `count` Thursdays from now (Indian weekly expiry)."""
    now = datetime.now()
    d = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # Advance to next Thursday (weekday 3)
    while d.weekday() != 3:
        d += timedelta(days=1)
    results = []
    for _ in range(count):
        results.append(d)
        d += timedelta(days=7)
    return results


def format_date_label(d: datetime) -> str:
    """Format a date as '25 Jun 2026'."""
    months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    return f"{d.day} {months[d.month - 1]} {d.year}"


def format_expiry_date(d: datetime) -> str:
    """Format a date as '2026-06-25'."""
    return f"{d.year}-{d.month:02d}-{d.day:02d}"


def compact_expiry(expiry_date: str) -> str:
    """Convert '2026-06-25' → '260625' for instrument key generation."""
    return expiry_date.replace("-", "")[2:]


def round2(value: float) -> float:
    """Round to 2 decimal places."""
    return round(value * 100) / 100


def round3(value: float) -> float:
    """Round to 3 decimal places."""
    return round(value * 1000) / 1000


def round4(value: float) -> float:
    """Round to 4 decimal places."""
    return round(value * 10000) / 10000


def round6(value: float) -> float:
    """Round to 6 decimal places."""
    return round(value * 1000000) / 1000000


# ============ Data Simulator Class ============


class DataSimulator:
    """
    Realistic Indian market data simulator.

    Generates deterministic, realistic market data including:
    - Spot prices via Geometric Brownian Motion (GBM)
    - Option chain via Black-Scholes pricing with IV smile
    - Open Interest patterns with realistic ATM concentration
    - 7-Strike COI PCR matrix and signal generation
    - Trade suggestions with proper SL/target/R:R
    - Volume proxy with classification
    - Trap cluster detection
    - 120 pre-generated historical COI PCR data points
    """

    def __init__(self):
        self.rng = mulberry32(42)
        self.spot_prices: Dict[str, float] = {}
        self.open_prices: Dict[str, float] = {}
        self.high_prices: Dict[str, float] = {}
        self.low_prices: Dict[str, float] = {}
        self.prev_close_prices: Dict[str, float] = {}
        self.volumes: Dict[str, int] = {}
        self.candles: Dict[str, list] = {}
        self.oi_data: Dict[str, Dict[int, Dict[str, int]]] = {}
        self.pcr_history: Dict[str, list] = {}
        self.tick_count: int = 0
        self.signal_history: Dict[str, list] = {}
        self.last_state: Dict[str, str] = {}
        self.last_pcr: Dict[str, float] = {}

        # 7-Strike tracking state
        self.coi_pcr_history: Dict[str, list] = {}
        self.volume_proxy_history: Dict[str, list] = {}
        self.trap_clusters_data: Dict[str, list] = {}
        self.trade_suggestions: Dict[str, list] = {}
        self.last_atm_strike: Dict[str, int] = {}
        self.stabilization_until: Dict[str, int] = {}
        self.last_signal_type: Dict[str, str] = {}
        self.gate_condition_active: Dict[str, Optional[Dict[str, Any]]] = {}

        # Initialize spot prices and basic state for each underlying
        for symbol, config in UNDERLYING_CONFIG.items():
            start_price = config["base_price"] + (self.rng() - 0.5) * config["base_price"] * 0.02
            self.spot_prices[symbol] = start_price
            self.open_prices[symbol] = start_price
            self.high_prices[symbol] = start_price * 1.005
            self.low_prices[symbol] = start_price * 0.995
            self.prev_close_prices[symbol] = start_price * (1 + (self.rng() - 0.5) * 0.01)
            self.volumes[symbol] = int(self.rng() * 5_000_000) + 1_000_000
            self.candles[symbol] = {}
            self.oi_data[symbol] = {}
            self.pcr_history[symbol] = []
            self.signal_history[symbol] = []
            self.last_state[symbol] = "IDLE"
            self.last_pcr[symbol] = 1.0

        # Generate all historical data
        self._generate_historical_candles()
        self._generate_initial_oi()
        self._generate_initial_pcr()
        self._generate_7strike_history()

    # ================================================================
    # Spot Price Generation — Geometric Brownian Motion
    # ================================================================

    def _generate_tick(self, symbol: str) -> Dict[str, Any]:
        """Generate a new spot price tick using GBM."""
        config = UNDERLYING_CONFIG.get(symbol)
        if not config:
            raise ValueError(f"Unknown symbol: {symbol}")

        prev_price = self.spot_prices[symbol]
        # GBM: dS = mu * S * dt + sigma * S * sqrt(dt) * Z
        mu = 0.0001  # small drift
        dt = 1.0 / 252.0 / 375.0  # ~1 tick in a trading day
        sigma = config["volatility"]
        z = normal_random(self.rng)
        dS = mu * prev_price * dt + sigma * prev_price * math.sqrt(dt) * z
        new_price = max(prev_price + dS, prev_price * 0.95)

        self.spot_prices[symbol] = new_price
        self.high_prices[symbol] = max(self.high_prices[symbol], new_price)
        self.low_prices[symbol] = min(self.low_prices[symbol], new_price)
        self.volumes[symbol] += int(self.rng() * 5000) + 100

        change = new_price - self.prev_close_prices[symbol]
        change_pct = (change / self.prev_close_prices[symbol]) * 100
        self.tick_count += 1

        # Update OI every 5 ticks
        if self.tick_count % 5 == 0:
            self._update_oi(symbol)

        return {
            "symbol": symbol,
            "ltp": round2(new_price),
            "change": round2(change),
            "change_pct": round2(change_pct),
            "open": round2(self.open_prices[symbol]),
            "high": round2(self.high_prices[symbol]),
            "low": round2(self.low_prices[symbol]),
            "close": round2(new_price),
            "volume": self.volumes[symbol],
            "timestamp": int(time.time() * 1000),
        }

    def get_spot_price(self, symbol: str) -> float:
        """Get current spot price for a symbol."""
        return self.spot_prices.get(symbol, UNDERLYING_CONFIG.get(symbol, {}).get("base_price", 23500))

    # ================================================================
    # Historical Candle Generation
    # ================================================================

    def _generate_historical_candles(self):
        """Pre-generate 220 candles per symbol/timeframe combination."""
        now = int(time.time())

        for symbol in UNDERLYING_CONFIG:
            config = UNDERLYING_CONFIG[symbol]
            for tf, tf_seconds in TIMEFRAME_MAP.items():
                key = f"{symbol}_{tf}"
                candle_list = []
                start_price = self.spot_prices[symbol]
                price = start_price * (1 + (self.rng() - 0.5) * 0.03)

                # Separate deterministic RNG for candles
                seed = 1234 if symbol == "NIFTY" else 5678
                tf_offset = {"1m": 0, "3m": 1, "5m": 2, "15m": 3, "1h": 4}.get(tf, 0)
                candle_rng = mulberry32(seed + tf_offset)

                num_candles = 220
                for i in range(num_candles, 0, -1):
                    t = now - i * tf_seconds
                    open_price = price

                    # Simulate intra-candle movement
                    num_steps = {"1h": 60, "15m": 15, "5m": 5, "3m": 3}.get(tf, 1)
                    high = open_price
                    low = open_price
                    close = open_price

                    for _ in range(num_steps):
                        mu = 0.00002
                        dt = 1.0 / 252.0 / 375.0
                        sigma = config["volatility"]
                        z = normal_random(candle_rng)
                        dS = mu * close * dt + sigma * close * math.sqrt(dt) * z
                        close = max(close + dS, close * 0.98)
                        high = max(high, close)
                        low = min(low, close)

                    volume = (
                        int(candle_rng() * 200000)
                        + 50000
                        + int(math.sin(i / 20) * 30000)
                    )

                    candle_list.append({
                        "time": t,
                        "open": round2(open_price),
                        "high": round2(high),
                        "low": round2(low),
                        "close": round2(close),
                        "volume": max(volume, 1000),
                    })
                    price = close

                # Align last candle with current spot price
                if candle_list:
                    candle_list[-1]["close"] = round2(self.spot_prices[symbol])

                self.candles[key] = candle_list

    # ================================================================
    # Open Interest Generation
    # ================================================================

    def _get_strikes(self, symbol: str, num_each_side: int) -> List[int]:
        """Get strike prices centered around ATM."""
        config = UNDERLYING_CONFIG.get(symbol, {})
        spot = self.spot_prices.get(symbol, 23500)
        step = config.get("strike_step", 50)
        atm = round(spot / step) * step
        strikes = []
        for i in range(-num_each_side, num_each_side + 1):
            strikes.append(atm + i * step)
        return strikes

    def _generate_initial_oi(self):
        """Generate initial OI data with realistic patterns."""
        for symbol, config in UNDERLYING_CONFIG.items():
            spot = self.spot_prices[symbol]
            step = config["strike_step"]
            atm = round(spot / step) * step
            strikes = self._get_strikes(symbol, 10)

            self.oi_data[symbol] = {}
            for strike in strikes:
                distance_from_atm = abs(strike - atm)
                round_bonus = (
                    1.5 if strike % 1000 == 0 else (1.2 if strike % 500 == 0 else 1.0)
                )
                base_oi = int(
                    (2_000_000 + self.rng() * 4_000_000)
                    * math.exp(-distance_from_atm / (step * 15))
                    * round_bonus
                )

                ce_change_oi = int((self.rng() - 0.4) * 400_000)
                pe_change_oi = int((self.rng() - 0.4) * 400_000)

                self.oi_data[symbol][strike] = {
                    "ce_oi": base_oi + int(self.rng() * 1_000_000),
                    "ce_change_oi": ce_change_oi,
                    "pe_oi": base_oi + int(self.rng() * 1_000_000),
                    "pe_change_oi": pe_change_oi,
                }

    def _update_oi(self, symbol: str):
        """Update OI data with small random changes."""
        data = self.oi_data.get(symbol)
        if not data:
            return
        for strike_str in list(data.keys()):
            d = data[strike_str]
            d["ce_change_oi"] += int((self.rng() - 0.45) * 10_000)
            d["pe_change_oi"] += int((self.rng() - 0.45) * 10_000)
            d["ce_oi"] += int(self.rng() * 5_000)
            d["pe_oi"] += int(self.rng() * 5_000)
            # Clamp change OI to reasonable range
            d["ce_change_oi"] = max(-d["ce_oi"], min(d["ce_oi"], d["ce_change_oi"]))
            d["pe_change_oi"] = max(-d["pe_oi"], min(d["pe_oi"], d["pe_change_oi"]))

    # ================================================================
    # PCR History Generation
    # ================================================================

    def _generate_initial_pcr(self):
        """Generate 60 PCR history points at 1-minute intervals."""
        now_ms = int(time.time() * 1000)
        for symbol in UNDERLYING_CONFIG:
            pcr_points = []
            last_pcr = 0.9 + self.rng() * 0.3
            base_spot = self.spot_prices[symbol]
            spot = base_spot * (1 + (self.rng() - 0.5) * 0.01)

            for i in range(60, 0, -1):
                timestamp = now_ms - i * 60_000
                spot += (self.rng() - 0.5) * base_spot * 0.001
                last_pcr += (self.rng() - 0.5) * 0.05
                last_pcr = max(0.3, min(2.5, last_pcr))
                change_pcr = (self.rng() - 0.5) * 0.1

                pcr_points.append({
                    "timestamp": timestamp,
                    "spot": round2(spot),
                    "pcr": round3(last_pcr),
                    "change_pcr": round3(change_pcr),
                })

            self.pcr_history[symbol] = pcr_points
            self.last_pcr[symbol] = last_pcr

    # ================================================================
    # Black-Scholes Option Pricing
    # ================================================================

    def _bs_price(
        self, S: float, K: float, T: float, sigma: float, opt_type: str
    ) -> Dict[str, float]:
        """Black-Scholes option pricing with Greeks.

        Args:
            S: Spot price
            K: Strike price
            T: Time to expiry (in years)
            sigma: Implied volatility
            opt_type: 'CE' or 'PE'

        Returns:
            Dict with price, delta, gamma, theta, vega
        """
        if T <= 0:
            intrinsic = max(S - K, 0) if opt_type == "CE" else max(K - S, 0)
            return {"price": intrinsic, "delta": 0, "gamma": 0, "theta": 0, "vega": 0}

        r = RISK_FREE_RATE
        sqrtT = math.sqrt(T)
        d1 = (math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT)
        d2 = d1 - sigma * sqrtT

        nd1 = cdf(d1)
        nd2 = cdf(d2)
        nnd1 = cdf(-d1)
        nnd2 = cdf(-d2)
        npd1 = ndist(d1)

        if opt_type == "CE":
            price = S * nd1 - K * math.exp(-r * T) * nd2
            delta = nd1
        else:
            price = K * math.exp(-r * T) * nnd2 - S * nnd1
            delta = nd1 - 1

        gamma = npd1 / (S * sigma * sqrtT)
        theta = (
            -(S * npd1 * sigma) / (2 * sqrtT)
            - (
                r * K * math.exp(-r * T) * nd2
                if opt_type == "CE"
                else -r * K * math.exp(-r * T) * nnd2
            )
        ) / 365
        vega = (S * npd1 * sqrtT) / 100

        return {
            "price": max(price, 0.05),
            "delta": round4(delta),
            "gamma": round6(gamma),
            "theta": round2(theta),
            "vega": round2(vega),
        }

    def _get_iv(self, strike: float, atm: float, base_iv: float) -> float:
        """Generate IV with smile shape.

        IV smile: base + skew * distance² + tilt * (-moneyness) + noise
        """
        moneyness = (strike - atm) / atm
        skew = moneyness * moneyness * 2  # quadratic smile
        tilt = -moneyness * 0.05  # slight negative skew (put IV > call IV)
        return max(0.05, base_iv + skew + tilt + (self.rng() - 0.5) * 0.02)

    def _time_to_expiry(self, expiry: str) -> float:
        """Calculate time to expiry in years from an expiry date string."""
        if not expiry:
            return 7.0 / 365.0
        try:
            expiry_dt = datetime.strptime(expiry, "%Y-%m-%d").replace(
                hour=15, minute=30
            )
            now = datetime.now()
            diff_days = (expiry_dt - now).total_seconds() / (24 * 3600)
            return max(diff_days / 365.0, 0.001)
        except (ValueError, TypeError):
            return 7.0 / 365.0

    # ================================================================
    # Public API — Candles
    # ================================================================

    def get_candles(self, instrument_key: str, timeframe: str) -> List[Dict]:
        """Get candle data for an instrument and timeframe.

        instrument_key can be "NIFTY", "BANKNIFTY", or option key like
        "NSE_FO|NIFTY26062523500CE".
        """
        symbol = instrument_key
        if instrument_key.startswith("NSE_FO|"):
            parsed = self._parse_instrument_key_simple(instrument_key)
            if parsed:
                symbol = parsed["underlying"]

        tf = timeframe if timeframe in TIMEFRAME_MAP else "1m"
        key = f"{symbol}_{tf}"
        return self.candles.get(key, [])

    def _parse_instrument_key_simple(self, key: str) -> Optional[Dict]:
        """Parse an instrument key like 'NSE_FO|NIFTY26062523500CE'."""
        try:
            parts = key.split("|")
            if len(parts) < 2:
                return None
            body = parts[1]

            underlying = ""
            rest = body
            if body.startswith("BANKNIFTY"):
                underlying = "BANKNIFTY"
                rest = body[9:]
            elif body.startswith("NIFTY"):
                underlying = "NIFTY"
                rest = body[5:]
            else:
                return None

            option_type = ""
            if rest.endswith("CE"):
                option_type = "CE"
            elif rest.endswith("PE"):
                option_type = "PE"
            if not option_type:
                return None
            rest = rest[:-2]

            # Extract strike from the end
            strike_str = ""
            while rest and rest[-1].isdigit():
                strike_str = rest[-1] + strike_str
                rest = rest[:-1]
            if not strike_str:
                return None
            strike = int(strike_str)

            # Rest is expiry part
            expiry_part = rest
            if len(expiry_part) >= 6:
                year = 2000 + int(expiry_part[:2])
                month = int(expiry_part[2:4])
                day = int(expiry_part[4:6])
                expiry = f"{year}-{month:02d}-{day:02d}"
            else:
                expiry = ""

            return {"underlying": underlying, "expiry": expiry, "strike": strike, "option_type": option_type}
        except Exception:
            return None

    # ================================================================
    # Public API — Option Chain
    # ================================================================

    def get_option_chain(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Fetch full option chain with Greeks for all strikes."""
        config = UNDERLYING_CONFIG.get(underlying)
        if not config:
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": 0,
                "atm_strike": 0,
                "strike_step": 0,
                "chain": [],
            }

        spot = self.get_spot_price(underlying)
        step = config["strike_step"]
        atm = round(spot / step) * step
        strikes = self._get_strikes(underlying, 10)

        T = self._time_to_expiry(expiry)
        base_iv = config["volatility"]

        chain = []
        for strike in strikes:
            iv = self._get_iv(strike, atm, base_iv)
            ce_greeks = self._bs_price(spot, strike, T, iv, "CE")
            pe_greeks = self._bs_price(spot, strike, T, iv, "PE")
            oi_info = self.oi_data.get(underlying, {}).get(
                strike,
                {"ce_oi": 0, "ce_change_oi": 0, "pe_oi": 0, "pe_change_oi": 0},
            )

            spread = max(0.5, ce_greeks["price"] * 0.005)
            ce_expiry_compact = compact_expiry(expiry) if expiry else "260625"

            chain.append({
                "strike": strike,
                "ce": {
                    "instrument_key": f"NSE_FO|{underlying}{ce_expiry_compact}{strike}CE",
                    "ltp": round2(ce_greeks["price"]),
                    "oi": oi_info["ce_oi"],
                    "change_oi": oi_info["ce_change_oi"],
                    "volume": int(self.rng() * 100_000) + 10_000,
                    "iv": round2(iv),
                    "delta": ce_greeks["delta"],
                    "gamma": ce_greeks["gamma"],
                    "theta": ce_greeks["theta"],
                    "vega": ce_greeks["vega"],
                    "bid_price": round2(ce_greeks["price"] - spread / 2),
                    "ask_price": round2(ce_greeks["price"] + spread / 2),
                },
                "pe": {
                    "instrument_key": f"NSE_FO|{underlying}{ce_expiry_compact}{strike}PE",
                    "ltp": round2(pe_greeks["price"]),
                    "oi": oi_info["pe_oi"],
                    "change_oi": oi_info["pe_change_oi"],
                    "volume": int(self.rng() * 100_000) + 10_000,
                    "iv": round2(iv),
                    "delta": pe_greeks["delta"],
                    "gamma": pe_greeks["gamma"],
                    "theta": pe_greeks["theta"],
                    "vega": pe_greeks["vega"],
                    "bid_price": round2(pe_greeks["price"] - spread / 2),
                    "ask_price": round2(pe_greeks["price"] + spread / 2),
                },
            })

        return {
            "underlying": underlying,
            "expiry": expiry,
            "spot_price": round2(spot),
            "atm_strike": atm,
            "strike_step": step,
            "chain": chain,
        }

    def get_mini_option_chain(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Fetch compact option chain (no gamma/theta/vega) for bottom panel."""
        full = self.get_option_chain(underlying, expiry)
        mini_chain = []
        for row in full["chain"]:
            mini_chain.append({
                "strike": row["strike"],
                "ce": {
                    "instrument_key": row["ce"]["instrument_key"],
                    "ltp": row["ce"]["ltp"],
                    "oi": row["ce"]["oi"],
                    "change_oi": row["ce"]["change_oi"],
                    "volume": row["ce"]["volume"],
                    "iv": row["ce"]["iv"],
                    "delta": row["ce"]["delta"],
                    "bid_price": row["ce"]["bid_price"],
                    "ask_price": row["ce"]["ask_price"],
                },
                "pe": {
                    "instrument_key": row["pe"]["instrument_key"],
                    "ltp": row["pe"]["ltp"],
                    "oi": row["pe"]["oi"],
                    "change_oi": row["pe"]["change_oi"],
                    "volume": row["pe"]["volume"],
                    "iv": row["pe"]["iv"],
                    "delta": row["pe"]["delta"],
                    "bid_price": row["pe"]["bid_price"],
                    "ask_price": row["pe"]["ask_price"],
                },
            })

        return {
            "underlying": full["underlying"],
            "expiry": full["expiry"],
            "spot_price": full["spot_price"],
            "atm_strike": full["atm_strike"],
            "strike_step": full["strike_step"],
            "chain": mini_chain,
        }

    # ================================================================
    # Public API — OI Data
    # ================================================================

    def get_oi_data(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Get OI data across strikes."""
        config = UNDERLYING_CONFIG.get(underlying)
        if not config:
            return {"underlying": underlying, "expiry": expiry, "spot_price": 0, "data": []}

        spot = self.get_spot_price(underlying)
        strikes = self._get_strikes(underlying, 10)

        data = []
        for strike in strikes:
            oi_info = self.oi_data.get(underlying, {}).get(
                strike,
                {"ce_oi": 0, "ce_change_oi": 0, "pe_oi": 0, "pe_change_oi": 0},
            )
            data.append({
                "timestamp": int(time.time() * 1000),
                "strike": strike,
                "ce_oi": oi_info["ce_oi"],
                "ce_change_oi": oi_info["ce_change_oi"],
                "pe_oi": oi_info["pe_oi"],
                "pe_change_oi": oi_info["pe_change_oi"],
            })

        return {"underlying": underlying, "expiry": expiry, "spot_price": round2(spot), "data": data}

    # ================================================================
    # Public API — PCR
    # ================================================================

    def get_pcr(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Get PCR history and current values."""
        history = self.pcr_history.get(underlying, [])
        current_pcr = history[-1]["pcr"] if history else 1.0
        current_change = history[-1]["change_pcr"] if history else 0

        return {
            "underlying": underlying,
            "expiry": expiry,
            "data": history,
            "current_pcr": round3(current_pcr),
            "current_change_pcr": round3(current_change),
        }

    # ================================================================
    # Public API — Expiries
    # ================================================================

    def get_expiries(self, underlying: str) -> List[Dict[str, Any]]:
        """Get upcoming weekly expiry dates (next 6 Thursdays)."""
        thursdays = next_thursdays(6)
        now = datetime.now()
        return [
            {
                "expiry_date": format_expiry_date(d),
                "expiry_label": format_date_label(d),
                "is_weekly": True,
                "days_to_expiry": (d - now).days,
            }
            for d in thursdays
        ]

    # ================================================================
    # Public API — Instrument Search
    # ================================================================

    def search_instruments(self, query: str) -> List[Dict[str, Any]]:
        """Search for instruments matching a query string.

        Supports human-readable queries like 'NIFTY 23900 CE 25 Jun 2026'.
        """
        q = query.upper().strip()
        results = []

        parts = q.split()
        search_underlying = ""
        search_strike = None
        search_option_type = ""

        for part in parts:
            if part in ("NIFTY", "NIFTY50"):
                search_underlying = "NIFTY"
            elif part in ("BANKNIFTY", "BANK", "BNF"):
                search_underlying = "BANKNIFTY"
            elif part in ("CE", "PE"):
                search_option_type = part
            elif part.isdigit() and 3 <= len(part) <= 5:
                search_strike = int(part)

        # Fallback: detect underlying from full query
        if not search_underlying:
            if "NIFTY" in q and "BANK" not in q:
                search_underlying = "NIFTY"
            elif "BANKNIFTY" in q or "BNF" in q:
                search_underlying = "BANKNIFTY"

        expiries = next_thursdays(6)

        for symbol, config in UNDERLYING_CONFIG.items():
            if search_underlying and symbol != search_underlying:
                continue
            if not search_underlying and symbol not in q and config["display_name"].upper() not in q:
                continue

            # Add index
            results.append({
                "instrument_key": f"NSE_INDEX|{symbol}",
                "name": config["display_name"],
                "underlying": symbol,
                "type": "INDEX",
            })

            # Add options for each expiry
            for expiry_date in expiries:
                expiry = format_expiry_date(expiry_date)
                expiry_compact = compact_expiry(expiry)
                expiry_label = format_date_label(expiry_date)

                # Add futures
                results.append({
                    "instrument_key": f"NSE_FO|{symbol}{expiry_compact}FUT",
                    "name": f"{symbol} {expiry_label} FUT",
                    "underlying": symbol,
                    "type": "FUT",
                    "expiry": expiry,
                })

                # Add options
                spot = self.get_spot_price(symbol)
                step = config["strike_step"]
                atm = round(spot / step) * step
                range_val = 3 if search_strike else 5
                base_strike = search_strike or atm

                for i in range(-range_val, range_val + 1):
                    strike = base_strike + i * step
                    if strike <= 0:
                        continue
                    for opt_type in ["CE", "PE"]:
                        if search_option_type and opt_type != search_option_type:
                            continue

                        results.append({
                            "instrument_key": f"NSE_FO|{symbol}{expiry_compact}{strike}{opt_type}",
                            "name": f"{symbol} {strike} {opt_type}",
                            "underlying": symbol,
                            "type": opt_type,
                            "expiry": expiry,
                            "strike": strike,
                            "display_name": f"{symbol} {strike} {opt_type} {expiry_label}",
                        })

        return results[:30]

    # ================================================================
    # 7-Strike COI PCR Matrix
    # ================================================================

    def get_7strike_matrix(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Compute the 7-Strike COI PCR Matrix.

        Window: ATM ± 3 strikes
        COI PCR = Sum(PE Change OI) / Sum(CE Change OI) for the 7-strike window
        """
        config = UNDERLYING_CONFIG.get(underlying)
        if not config:
            return {
                "underlying": underlying,
                "expiry": expiry,
                "spot_price": 0,
                "atm_strike": 0,
                "strike_step": 0,
                "window_strikes": [],
                "rows": [],
                "ce_coi_sum": 0,
                "pe_coi_sum": 0,
                "coi_pcr": 1.0,
                "state": "IDLE",
            }

        spot = self.get_spot_price(underlying)
        step = config["strike_step"]
        atm = round(spot / step) * step

        # 7-strike window: ATM ± 3
        window_strikes = [atm + i * step for i in range(-3, 4)]

        rows = []
        for strike in window_strikes:
            oi_info = self.oi_data.get(underlying, {}).get(
                strike,
                {"ce_oi": 0, "ce_change_oi": 0, "pe_oi": 0, "pe_change_oi": 0},
            )
            rows.append({
                "strike": strike,
                "ce_coi": oi_info["ce_change_oi"],
                "pe_coi": oi_info["pe_change_oi"],
                "ce_oi": oi_info["ce_oi"],
                "pe_oi": oi_info["pe_oi"],
            })

        ce_coi_sum = sum(r["ce_coi"] for r in rows)
        pe_coi_sum = sum(r["pe_coi"] for r in rows)
        coi_pcr = pe_coi_sum / ce_coi_sum if ce_coi_sum != 0 else 1.0

        # State determination
        state = "IDLE"
        if coi_pcr > 1.5 or coi_pcr < 0.6:
            state = "ACTIVE"
        elif coi_pcr > 1.2 or coi_pcr < 0.8:
            state = "ZONE_WATCH"

        self.last_state[underlying] = state
        self.last_pcr[underlying] = coi_pcr

        return {
            "underlying": underlying,
            "expiry": expiry,
            "spot_price": round2(spot),
            "atm_strike": atm,
            "strike_step": step,
            "window_strikes": window_strikes,
            "rows": rows,
            "ce_coi_sum": ce_coi_sum,
            "pe_coi_sum": pe_coi_sum,
            "coi_pcr": round3(coi_pcr),
            "state": state,
        }

    # ================================================================
    # 7-Strike Signals
    # ================================================================

    def get_7strike_signals(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Generate trading signals based on 7-Strike COI PCR.

        Signal thresholds:
        - PCR > 1.5 → LONG (high confidence)
        - PCR > 1.2 → LONG (moderate confidence)
        - PCR < 0.6 → SHORT (high confidence)
        - PCR < 0.8 → SHORT (moderate confidence)
        - Otherwise → NEUTRAL
        """
        matrix = self.get_7strike_matrix(underlying, expiry)
        coi_pcr = matrix["coi_pcr"]
        state = matrix["state"]

        signals = self.signal_history.get(underlying, [])

        # Determine signal
        signal_type = "NEUTRAL"
        confidence = 0.0
        reason = "No significant COI PCR divergence"
        gate_condition = None
        volume_percent = None

        if coi_pcr > 1.5:
            signal_type = "LONG"
            confidence = min(0.95, 0.5 + (coi_pcr - 1.5) * 0.3 + self.rng() * 0.1)
            reason = f"Strong PE COI buildup (PCR: {coi_pcr:.3f}) suggests bearish resistance, bullish signal"
            gate_condition = "LONG"
            volume_percent = 75 + self.rng() * 20
        elif coi_pcr > 1.2:
            signal_type = "LONG"
            confidence = min(0.7, 0.3 + (coi_pcr - 1.2) * 0.5 + self.rng() * 0.1)
            reason = f"Moderate PE COI dominance (PCR: {coi_pcr:.3f}), watch for confirmation"
            gate_condition = "LONG"
        elif coi_pcr < 0.6:
            signal_type = "SHORT"
            confidence = min(0.95, 0.5 + (0.6 - coi_pcr) * 0.3 + self.rng() * 0.1)
            reason = f"Strong CE COI buildup (PCR: {coi_pcr:.3f}) suggests bullish resistance, bearish signal"
            gate_condition = "SHORT"
            volume_percent = 75 + self.rng() * 20
        elif coi_pcr < 0.8:
            signal_type = "SHORT"
            confidence = min(0.7, 0.3 + (0.8 - coi_pcr) * 0.5 + self.rng() * 0.1)
            reason = f"Moderate CE COI dominance (PCR: {coi_pcr:.3f}), watch for confirmation"
            gate_condition = "SHORT"

        current_signal = {
            "signal_type": signal_type,
            "confidence": round3(confidence),
            "reason": reason,
            "timestamp": int(time.time() * 1000),
            "spot_price": matrix["spot_price"],
            "coi_pcr": coi_pcr,
            "volume_percent": round2(volume_percent) if volume_percent is not None else None,
            "gate_condition": gate_condition,
            "pain_index": (
                matrix["atm_strike"] + (coi_pcr - 1) * 50
                if coi_pcr > 1
                else matrix["atm_strike"] - (1 - coi_pcr) * 50
            ),
        }

        # Add to history if signal type changed
        if not signals or signals[-1]["signal_type"] != signal_type:
            signals.append(current_signal)
            if len(signals) > 50:
                signals.pop(0)
            self.signal_history[underlying] = signals

        return {
            "underlying": underlying,
            "expiry": expiry,
            "signals": signals,
            "current_signal": current_signal,
            "gate_condition": gate_condition or "NONE",
            "state": state,
        }

    # ================================================================
    # 7-Strike History — Pre-generation (120 data points)
    # ================================================================

    def _generate_7strike_history(self):
        """Pre-generate 120 historical COI PCR data points.

        Simulates 2 hours of 1-minute interval data for each underlying.
        Uses separate deterministic PRNG for reproducibility.
        """
        now_ms = int(time.time() * 1000)

        for symbol, config in UNDERLYING_CONFIG.items():
            step = config["strike_step"]
            base_spot = self.spot_prices[symbol]

            # Initialize arrays
            self.coi_pcr_history[symbol] = []
            self.volume_proxy_history[symbol] = []
            self.trap_clusters_data[symbol] = []
            self.trade_suggestions[symbol] = []
            self.last_atm_strike[symbol] = round(base_spot / step) * step
            self.stabilization_until[symbol] = 0
            self.last_signal_type[symbol] = "NEUTRAL"
            self.gate_condition_active[symbol] = None

            # Separate deterministic RNG for history
            hist_rng = mulberry32(9876 if symbol == "NIFTY" else 5432)
            spot = base_spot * (1 + (hist_rng() - 0.5) * 0.005)
            last_pcr = 0.9 + hist_rng() * 0.3
            last_signal = "NEUTRAL"
            gate_active = None
            prev_atm = round(spot / step) * step

            for i in range(120, 0, -1):
                timestamp = now_ms - i * 60_000  # 1-minute intervals

                # Simulate spot movement
                spot += (hist_rng() - 0.5) * base_spot * 0.001
                current_atm = round(spot / step) * step

                # Check for ATM shift
                if current_atm != prev_atm:
                    self.stabilization_until[symbol] = timestamp + 120_000  # 2-min stabilization

                # Generate COI PCR values
                ce_coi_base = int((hist_rng() - 0.4) * 400_000)
                pe_coi_base = int((hist_rng() - 0.4) * 400_000)
                ce_coi_sum = ce_coi_base + int(hist_rng() * 200_000)
                pe_coi_sum = pe_coi_base + int(hist_rng() * 200_000)

                last_pcr += (hist_rng() - 0.5) * 0.04
                last_pcr = max(0.3, min(2.5, last_pcr))
                coi_pcr = pe_coi_sum / ce_coi_sum if ce_coi_sum != 0 else 1.0

                # Determine state
                state = "IDLE"
                if coi_pcr > 1.5 or coi_pcr < 0.6:
                    state = "ACTIVE"
                elif coi_pcr > 1.2 or coi_pcr < 0.8:
                    state = "ZONE_WATCH"

                # Determine signal type
                signal_type = "NEUTRAL"
                confidence = 0.0
                if coi_pcr > 1.5:
                    signal_type = "LONG"
                    confidence = min(0.95, 0.5 + (coi_pcr - 1.5) * 0.3 + hist_rng() * 0.1)
                elif coi_pcr > 1.2:
                    signal_type = "LONG"
                    confidence = min(0.7, 0.3 + (coi_pcr - 1.2) * 0.5 + hist_rng() * 0.1)
                elif coi_pcr < 0.6:
                    signal_type = "SHORT"
                    confidence = min(0.95, 0.5 + (0.6 - coi_pcr) * 0.3 + hist_rng() * 0.1)
                elif coi_pcr < 0.8:
                    signal_type = "SHORT"
                    confidence = min(0.7, 0.3 + (0.8 - coi_pcr) * 0.5 + hist_rng() * 0.1)

                # Track gate condition
                if signal_type in ("LONG", "SHORT"):
                    if not gate_active or gate_active["type"] != signal_type:
                        gate_active = {"type": signal_type, "since": timestamp}
                else:
                    gate_active = None

                # Add COI PCR point
                self.coi_pcr_history[symbol].append({
                    "timestamp": timestamp,
                    "coi_pcr": round3(coi_pcr),
                    "spot": round2(spot),
                    "ce_coi_sum": ce_coi_sum,
                    "pe_coi_sum": pe_coi_sum,
                    "state": state,
                    "signal_type": signal_type,
                    "confidence": round3(confidence),
                })

                # Generate volume proxy
                volume_percent = 0.5 + hist_rng() * 3
                if hist_rng() < 0.05:
                    volume_percent = 5 + hist_rng() * 3  # spike

                if volume_percent >= 5:
                    classification = "EXTREME"
                elif volume_percent >= 3:
                    classification = "HIGH"
                elif volume_percent >= 1.5:
                    classification = "ELEVATED"
                else:
                    classification = "NORMAL"

                self.volume_proxy_history[symbol].append({
                    "timestamp": timestamp,
                    "volume_percent": round2(volume_percent),
                    "classification": classification,
                    "spot": round2(spot),
                })

                # Check for trap clusters when volume is HIGH or EXTREME
                if volume_percent >= 3.0:
                    if signal_type == "LONG":
                        direction = "BEARISH_TRAP"
                    elif signal_type == "SHORT":
                        direction = "BULLISH_TRAP"
                    else:
                        direction = "BULLISH_TRAP" if hist_rng() > 0.5 else "BEARISH_TRAP"

                    pain_index = (
                        current_atm + int(hist_rng() * 4) * step
                        if direction == "BULLISH_TRAP"
                        else current_atm - int(hist_rng() * 4) * step
                    )

                    self.trap_clusters_data[symbol].append({
                        "id": f"trap_{symbol}_{timestamp}",
                        "price_high": current_atm + step,
                        "price_low": current_atm - step,
                        "timestamp_start": timestamp,
                        "volume_trapped": int(volume_percent * 100_000),
                        "direction": direction,
                        "pain_index": pain_index,
                        "active": i <= 5,  # Only last 5 are still active
                        "triggered": i > 5,
                    })

                # Generate trade suggestions for significant signals
                if (signal_type in ("LONG", "SHORT")) and confidence > 0.6 and i % 15 == 0:
                    lot_size = 15 if symbol == "BANKNIFTY" else 25
                    entry_strike = current_atm

                    sl_pct = 0.30 if confidence > 0.8 else 0.40
                    target_pct = 1.50 if confidence > 0.8 else 1.00

                    T = 7.0 / 365.0
                    iv = config["volatility"]

                    if signal_type == "LONG":
                        greeks = self._bs_price(spot, entry_strike, T, iv, "CE")
                        entry_price = round2(greeks["price"])
                        stop_loss = max(0.05, round2(entry_price * (1 - sl_pct)))
                        target = round2(entry_price * (1 + target_pct))
                        option_suggestion = f"BUY {symbol} {entry_strike} CE (Lot: {lot_size})"
                    else:
                        greeks = self._bs_price(spot, entry_strike, T, iv, "PE")
                        entry_price = round2(greeks["price"])
                        stop_loss = max(0.05, round2(entry_price * (1 - sl_pct)))
                        target = round2(entry_price * (1 + target_pct))
                        option_suggestion = f"BUY {symbol} {entry_strike} PE (Lot: {lot_size})"

                    risk = entry_price - stop_loss
                    reward = target - entry_price
                    rr_ratio = f"{reward / risk:.1f}" if risk > 0 else "0.0"

                    self.trade_suggestions[symbol].append({
                        "id": f"trade_{symbol}_{timestamp}",
                        "signal_type": signal_type,
                        "entry_price": entry_price,
                        "stop_loss": stop_loss,
                        "target": target,
                        "risk_reward": f"1:{rr_ratio}",
                        "confidence": round3(confidence),
                        "reason": (
                            f"Strong PE COI buildup (PCR: {coi_pcr:.3f}) — bullish signal"
                            if signal_type == "LONG"
                            else f"Strong CE COI buildup (PCR: {coi_pcr:.3f}) — bearish signal"
                        ),
                        "timestamp": timestamp,
                        "spot_price": round2(spot),
                        "coi_pcr": round3(coi_pcr),
                        "status": "HIT_TARGET" if i > 10 else "ACTIVE",
                        "option_suggestion": option_suggestion,
                        "exit_reason": "Target achieved" if i > 10 else None,
                    })

                last_signal = signal_type

            self.last_atm_strike[symbol] = prev_atm
            self.last_signal_type[symbol] = last_signal
            self.gate_condition_active[symbol] = gate_active

    # ================================================================
    # 7-Strike COI PCR History — Live Update
    # ================================================================

    def _update_coi_pcr_history(self, underlying: str):
        """Update COI PCR history with current data point.

        Detects ATM shifts and adds 2-minute stabilization periods.
        Tracks gate condition state.
        """
        config = UNDERLYING_CONFIG.get(underlying)
        if not config:
            return

        matrix = self.get_7strike_matrix(underlying, "")
        spot = matrix["spot_price"]
        current_atm = matrix["atm_strike"]

        # Check for ATM shift
        prev_atm = self.last_atm_strike.get(underlying, current_atm)
        if current_atm != prev_atm:
            self.stabilization_until[underlying] = int(time.time() * 1000) + 120_000
            self.last_atm_strike[underlying] = current_atm

        # Determine signal from current matrix
        coi_pcr = matrix["coi_pcr"]
        signal_type = "NEUTRAL"
        confidence = 0.0
        if coi_pcr > 1.5:
            signal_type = "LONG"
            confidence = min(0.95, 0.5 + (coi_pcr - 1.5) * 0.3 + self.rng() * 0.1)
        elif coi_pcr > 1.2:
            signal_type = "LONG"
            confidence = min(0.7, 0.3 + (coi_pcr - 1.2) * 0.5 + self.rng() * 0.1)
        elif coi_pcr < 0.6:
            signal_type = "SHORT"
            confidence = min(0.95, 0.5 + (0.6 - coi_pcr) * 0.3 + self.rng() * 0.1)
        elif coi_pcr < 0.8:
            signal_type = "SHORT"
            confidence = min(0.7, 0.3 + (0.8 - coi_pcr) * 0.5 + self.rng() * 0.1)

        # Update gate condition tracking
        if signal_type in ("LONG", "SHORT"):
            current_gate = self.gate_condition_active.get(underlying)
            if not current_gate or current_gate.get("type") != signal_type:
                self.gate_condition_active[underlying] = {
                    "type": signal_type,
                    "since": int(time.time() * 1000),
                }
        else:
            self.gate_condition_active[underlying] = None

        point = {
            "timestamp": int(time.time() * 1000),
            "coi_pcr": coi_pcr,
            "spot": spot,
            "ce_coi_sum": matrix["ce_coi_sum"],
            "pe_coi_sum": matrix["pe_coi_sum"],
            "state": matrix["state"],
            "signal_type": signal_type,
            "confidence": round3(confidence),
        }

        if underlying not in self.coi_pcr_history:
            self.coi_pcr_history[underlying] = []
        self.coi_pcr_history[underlying].append(point)

        # Keep max 300 points
        if len(self.coi_pcr_history[underlying]) > 300:
            self.coi_pcr_history[underlying].pop(0)

        self.last_signal_type[underlying] = signal_type

    # ================================================================
    # Volume Proxy — Live Update
    # ================================================================

    def _update_volume_proxy(self, underlying: str):
        """Update volume proxy with current data point.

        Classifies volume as NORMAL/ELEVATED/HIGH/EXTREME.
        Creates trap clusters when volume_percent >= 3.0.
        """
        config = UNDERLYING_CONFIG.get(underlying)
        if not config:
            return

        spot = self.get_spot_price(underlying)
        step = config["strike_step"]
        atm = round(spot / step) * step

        # Simulate volume_percent
        volume_percent = 0.5 + self.rng() * 3
        # 5% chance of spike
        if self.rng() < 0.05:
            volume_percent = 5 + self.rng() * 3

        if volume_percent >= 5:
            classification = "EXTREME"
        elif volume_percent >= 3:
            classification = "HIGH"
        elif volume_percent >= 1.5:
            classification = "ELEVATED"
        else:
            classification = "NORMAL"

        point = {
            "timestamp": int(time.time() * 1000),
            "volume_percent": round2(volume_percent),
            "classification": classification,
            "spot": round2(spot),
        }

        if underlying not in self.volume_proxy_history:
            self.volume_proxy_history[underlying] = []
        self.volume_proxy_history[underlying].append(point)

        # Keep max 300 points
        if len(self.volume_proxy_history[underlying]) > 300:
            self.volume_proxy_history[underlying].pop(0)

        # Check for trap clusters when volume is HIGH or EXTREME
        if volume_percent >= 3.0:
            last_signal = self.last_signal_type.get(underlying, "NEUTRAL")
            if last_signal == "LONG":
                direction = "BEARISH_TRAP"
            elif last_signal == "SHORT":
                direction = "BULLISH_TRAP"
            else:
                direction = "BULLISH_TRAP" if self.rng() > 0.5 else "BEARISH_TRAP"

            pain_index = (
                atm + int(self.rng() * 4) * step
                if direction == "BULLISH_TRAP"
                else atm - int(self.rng() * 4) * step
            )

            now_ms = int(time.time() * 1000)
            cluster = {
                "id": f"trap_{underlying}_{now_ms}",
                "price_high": atm + step,
                "price_low": atm - step,
                "timestamp_start": now_ms,
                "volume_trapped": int(volume_percent * 100_000),
                "direction": direction,
                "pain_index": pain_index,
                "active": True,
                "triggered": False,
            }

            if underlying not in self.trap_clusters_data:
                self.trap_clusters_data[underlying] = []
            self.trap_clusters_data[underlying].append(cluster)

            # Mark older clusters as triggered/inactive (> 10 minutes)
            clusters = self.trap_clusters_data[underlying]
            for c in clusters[:-1]:
                if now_ms - c["timestamp_start"] > 600_000:
                    c["active"] = False
                    c["triggered"] = True

            # Keep max 50 clusters
            if len(clusters) > 50:
                clusters.pop(0)

    # ================================================================
    # Public API — 7-Strike History
    # ================================================================

    def get_7strike_history(self, underlying: str, expiry: str) -> Dict[str, Any]:
        """Get 7-Strike history with COI PCR series, volume proxy, trap clusters.

        Generates a fresh data point before returning.
        """
        # Generate fresh current data point
        self._update_coi_pcr_history(underlying)
        self._update_volume_proxy(underlying)

        # Filter active trap clusters
        active_traps = [
            c for c in self.trap_clusters_data.get(underlying, []) if c.get("active", False)
        ]

        return {
            "underlying": underlying,
            "expiry": expiry,
            "coi_pcr_series": self.coi_pcr_history.get(underlying, []),
            "volume_proxy_series": self.volume_proxy_history.get(underlying, []),
            "trap_clusters": active_traps,
            "signals": self.signal_history.get(underlying, []),
            "trade_suggestions": self.trade_suggestions.get(underlying, []),
        }

    # ================================================================
    # Public API — 7-Strike Trade Suggestions
    # ================================================================

    def get_7strike_trade_suggestions(self, underlying: str, expiry: str) -> List[Dict]:
        """Generate trade suggestions based on current signals.

        Rate-limited to 1 per minute per signal type to prevent spam.
        Keeps max 50 suggestions.
        """
        signals = self.get_7strike_signals(underlying, expiry)
        current_signal = signals.get("current_signal")

        existing = self.trade_suggestions.get(underlying, [])

        if not current_signal or current_signal["confidence"] <= 0.6:
            return existing

        config = UNDERLYING_CONFIG.get(underlying)
        if not config:
            return existing

        lot_size = 15 if underlying == "BANKNIFTY" else 25
        step = config["strike_step"]
        spot = self.get_spot_price(underlying)
        atm = round(spot / step) * step

        # Determine expiry for BS pricing
        if expiry:
            T = self._time_to_expiry(expiry)
        else:
            thurs = next_thursdays(1)
            T = self._time_to_expiry(format_expiry_date(thurs[0]))

        iv = config["volatility"]

        # Rate-limit: don't generate duplicate suggestions within 1 minute
        now_ms = int(time.time() * 1000)
        last_suggestion = existing[-1] if existing else None
        if (
            last_suggestion
            and last_suggestion["signal_type"] == current_signal["signal_type"]
            and now_ms - last_suggestion["timestamp"] < 60_000
        ):
            return existing

        signal_type = current_signal["signal_type"]
        confidence = current_signal["confidence"]

        # Option buying: SL below entry, target above entry
        sl_pct = 0.30 if confidence > 0.8 else 0.40
        target_pct = 1.50 if confidence > 0.8 else 1.00

        if signal_type == "LONG":
            greeks = self._bs_price(spot, atm, T, iv, "CE")
            entry_price = round2(greeks["price"])
            stop_loss = max(0.05, round2(entry_price * (1 - sl_pct)))
            target = round2(entry_price * (1 + target_pct))
            option_suggestion = f"BUY {underlying} {atm} CE (Lot: {lot_size}, Premium: ₹{entry_price})"
        else:
            greeks = self._bs_price(spot, atm, T, iv, "PE")
            entry_price = round2(greeks["price"])
            stop_loss = max(0.05, round2(entry_price * (1 - sl_pct)))
            target = round2(entry_price * (1 + target_pct))
            option_suggestion = f"BUY {underlying} {atm} PE (Lot: {lot_size}, Premium: ₹{entry_price})"

        risk = entry_price - stop_loss
        reward = target - entry_price
        rr_ratio = f"{reward / risk:.1f}" if risk > 0 else "0.0"

        suggestion = {
            "id": f"trade_{underlying}_{now_ms}",
            "signal_type": signal_type,
            "entry_price": entry_price,
            "stop_loss": stop_loss,
            "target": target,
            "risk_reward": f"1:{rr_ratio}",
            "confidence": round3(confidence),
            "reason": current_signal["reason"],
            "timestamp": now_ms,
            "spot_price": round2(spot),
            "coi_pcr": current_signal["coi_pcr"],
            "status": "ACTIVE",
            "option_suggestion": option_suggestion,
            "exit_reason": None,
        }

        if underlying not in self.trade_suggestions:
            self.trade_suggestions[underlying] = []
        self.trade_suggestions[underlying].append(suggestion)

        # Keep max 50 suggestions
        if len(self.trade_suggestions[underlying]) > 50:
            self.trade_suggestions[underlying].pop(0)

        return self.trade_suggestions[underlying]

    # ================================================================
    # Public API — Replay Sessions
    # ================================================================

    def get_replay_sessions(self) -> List[Dict[str, Any]]:
        """Get available replay sessions."""
        now_ms = int(time.time() * 1000)
        return [
            {
                "session_id": "demo-session-1",
                "underlying": "NIFTY",
                "start_time": datetime.fromtimestamp((now_ms - 3600000) / 1000).isoformat(),
                "end_time": datetime.fromtimestamp(now_ms / 1000).isoformat(),
                "candle_count": 60,
            },
            {
                "session_id": "demo-session-2",
                "underlying": "BANKNIFTY",
                "start_time": datetime.fromtimestamp((now_ms - 7200000) / 1000).isoformat(),
                "end_time": datetime.fromtimestamp((now_ms - 3600000) / 1000).isoformat(),
                "candle_count": 120,
            },
        ]

    def start_replay(self, session_id: str) -> Dict[str, Any]:
        """Start a replay session."""
        return {
            "session_id": session_id,
            "status": "started",
            "message": f"Replay session {session_id} started. Data will be emitted via WebSocket.",
        }

    # ================================================================
    # Periodic Update — Called by MarketEngine
    # ================================================================

    def update(self):
        """Update all simulated data. Called periodically by MarketEngine.

        Advances spot prices, updates OI, and generates new tick data.
        """
        for symbol in UNDERLYING_CONFIG:
            self._generate_tick(symbol)

            # Update PCR history
            history = self.pcr_history.get(symbol, [])
            if history:
                spot = self.spot_prices[symbol]
                last_pcr = self.last_pcr.get(symbol, 1.0)
                last_pcr += (self.rng() - 0.5) * 0.05
                last_pcr = max(0.3, min(2.5, last_pcr))
                change_pcr = (self.rng() - 0.5) * 0.1

                history.append({
                    "timestamp": int(time.time() * 1000),
                    "spot": round2(spot),
                    "pcr": round3(last_pcr),
                    "change_pcr": round3(change_pcr),
                })

                # Keep max 300 points
                if len(history) > 300:
                    history.pop(0)

                self.pcr_history[symbol] = history
                self.last_pcr[symbol] = last_pcr

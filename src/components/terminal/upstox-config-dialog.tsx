'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Settings,
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle2,
  XCircle,
  Link2,
  Key,
} from 'lucide-react';

interface UpstoxStatus {
  mode: 'live' | 'offline';
  connected: boolean;
  upstox_configured: boolean;
  masked_token: string;
}

export function UpstoxConfigDialog() {
  const [open, setOpen] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<UpstoxStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Fetch current status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/config/upstox');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('[UpstoxConfig] Failed to fetch status:', err);
    }
  }, []);

  // Fetch status on open
  useEffect(() => {
    if (open) {
      fetchStatus();
    }
  }, [open, fetchStatus]);

  // Connect to Upstox
  const handleConnect = async () => {
    if (!accessToken.trim()) {
      setError('Access token is required');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/config/upstox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken.trim(),
          api_key: apiKey.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess('Connected to Upstox! Live data is now active.');
        setAccessToken('');
        setApiKey('');
        await fetchStatus();
      } else {
        setError(data.error || 'Failed to connect to Upstox');
      }
    } catch (err) {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  // Disconnect from Upstox
  const handleDisconnect = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/config/upstox', { method: 'DELETE' });
      const data = await res.json();

      if (res.ok) {
        setSuccess('Disconnected from Upstox.');
        await fetchStatus();
      } else {
        setError(data.error || 'Failed to disconnect');
      }
    } catch (err) {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-gray-400 hover:text-gray-200"
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-[#111827] border-[#1f2937] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Key className="h-5 w-5 text-yellow-500" />
            Upstox API Configuration
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Connect to Upstox for live market data. No simulation — live data only.
          </DialogDescription>
        </DialogHeader>

        {/* Current Status */}
        <div className="rounded-lg bg-[#0a0e17] border border-[#1f2937] p-3 mt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Current Mode</span>
            {status ? (
              <Badge
                variant="outline"
                className={`gap-1 ${
                  status.connected
                    ? 'border-green-500/50 text-green-400 bg-green-500/10'
                    : 'border-yellow-500/50 text-yellow-400 bg-yellow-500/10'
                }`}
              >
                {status.connected ? (
                  <>
                    <Wifi className="h-3 w-3" />
                    LIVE
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3" />
                    OFFLINE
                  </>
                )}
              </Badge>
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
            )}
          </div>
          {status?.masked_token && (
            <div className="mt-2 text-xs text-gray-500">
              Token: {status.masked_token}
            </div>
          )}
        </div>

        <Separator className="bg-[#1f2937]" />

        {/* Connection Form */}
        {!status?.connected && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="access-token" className="text-xs text-gray-300">
                Access Token <span className="text-red-400">*</span>
              </Label>
              <Input
                id="access-token"
                type="password"
                placeholder="Enter your Upstox access token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="bg-[#0a0e17] border-[#1f2937] text-white text-sm placeholder:text-gray-600 focus:border-yellow-500/50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConnect();
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="api-key" className="text-xs text-gray-300">
                API Key <span className="text-gray-600">(optional)</span>
              </Label>
              <Input
                id="api-key"
                type="password"
                placeholder="Enter your Upstox API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-[#0a0e17] border-[#1f2937] text-white text-sm placeholder:text-gray-600 focus:border-yellow-500/50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConnect();
                }}
              />
            </div>

            <Button
              onClick={handleConnect}
              disabled={loading || !accessToken.trim()}
              className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {loading ? 'Connecting...' : 'Connect to Upstox'}
            </Button>
          </div>
        )}

        {/* Disconnect Button */}
        {status?.connected && (
          <Button
            onClick={handleDisconnect}
            disabled={loading}
            variant="destructive"
            className="w-full gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {loading ? 'Disconnecting...' : 'Disconnect from Upstox'}
          </Button>
        )}

        {/* Messages */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-2.5 text-xs text-red-400">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/30 p-2.5 text-xs text-green-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {success}
          </div>
        )}

        {/* Info */}
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5 text-xs text-amber-400/80">
          <p className="font-medium mb-1">No Simulation Mode</p>
          <p className="text-amber-400/60">
            This terminal only supports <strong>LIVE</strong> data from Upstox.
            No mock or simulated data is used. Connect your Upstox account to see real market data.
          </p>
          <p className="mt-1.5 font-medium">How to get your Upstox access token:</p>
          <ol className="list-decimal list-inside space-y-0.5 text-amber-400/60">
            <li>Log in to your Upstox developer account</li>
            <li>Create an app or use an existing one</li>
            <li>Complete the OAuth flow to get an access token</li>
            <li>Paste the token above and click Connect</li>
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { UserCancelledError } from "@zmkfirmware/zmk-studio-ts-client/transport/errors";
import type { AvailableDevice } from "./tauri/index";
import { Bluetooth, RefreshCw, X } from "lucide-react";
import { Key, ListBox, ListBoxItem, Selection } from "react-aria-components";
import { useModalRef } from "./misc/useModalRef";
import { ExternalLink } from "./misc/ExternalLink";
import { GenericModal } from "./GenericModal";

export type TransportFactory = {
  label: string;
  isWireless?: boolean;
  connect?: () => Promise<RpcTransport>;
  pick_and_connect?: {
    list: () => Promise<Array<AvailableDevice>>;
    connect: (dev: AvailableDevice) => Promise<RpcTransport>;
  };
};

export interface ConnectModalProps {
  open?: boolean;
  transports: TransportFactory[];
  onTransportCreated: (t: RpcTransport) => void;
  onDismiss?: () => void;
}

function deviceList(
  open: boolean,
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void
) {
  const [devices, setDevices] = useState<
    Array<[TransportFactory, AvailableDevice]>
  >([]);
  const [selectedDev, setSelectedDev] = useState(new Set<Key>());
  const [refreshing, setRefreshing] = useState(false);

  async function LoadEm() {
    setRefreshing(true);
    const entries: Array<[TransportFactory, AvailableDevice]> = [];
    for (const t of transports.filter((t) => t.pick_and_connect)) {
      const found = await t.pick_and_connect?.list();
      if (!found) {
        continue;
      }

      entries.push(
        ...found.map<[TransportFactory, AvailableDevice]>((d) => [t, d])
      );
    }

    setDevices(entries);
    setRefreshing(false);
  }

  useEffect(() => {
    setSelectedDev(new Set());
    setDevices([]);

    if (open) {
      LoadEm();
    }
  }, [transports, open, setDevices]);

  const onRefresh = useCallback(() => {
    setSelectedDev(new Set());
    setDevices([]);

    LoadEm();
  }, [setDevices]);

  const onSelect = useCallback(
    async (keys: Selection) => {
      if (keys === "all") {
        return;
      }
      const dev = devices.find(([_t, d]) => keys.has(d.id));
      if (dev) {
        dev[0]
          .pick_and_connect!.connect(dev[1])
          .then(onTransportCreated)
          .catch((e) => alert(e));
      }
    },
    [devices, onTransportCreated]
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto] items-center">
        <label className="text-sm font-medium">Select a Keyboard:</label>
        <button
          type="button"
          className="p-1 rounded hover:bg-base-300 disabled:bg-base-100 disabled:opacity-75"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw
            className={`size-4 transition-transform ${
              refreshing ? "animate-spin" : ""
            }`}
          />
        </button>
      </div>
      <ListBox
        aria-label="Device"
        items={devices}
        onSelectionChange={onSelect}
        selectionMode="single"
        selectedKeys={selectedDev}
        className="flex flex-col gap-1 pt-1 max-h-48 overflow-y-auto"
      >
        {([t, d]) => (
          <ListBoxItem
            className="grid grid-cols-[1.25em_1fr] items-center rounded bg-base-200 hover:bg-base-300 cursor-pointer px-2 py-1.5 text-sm"
            id={d.id}
            aria-label={d.label}
          >
            {t.isWireless && (
              <Bluetooth className="w-4 h-4 text-sky-400" />
            )}
            <span className="col-start-2">{d.label}</span>
          </ListBoxItem>
        )}
      </ListBox>
      {devices.length === 0 && !refreshing && (
        <p className="text-xs opacity-65">
          No USB/BLE Studio devices detected. Plug in the left half over USB or continue in offline mode.
        </p>
      )}
    </div>
  );
}

function simpleDevicePicker(
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void
) {
  const [availableDevices, setAvailableDevices] = useState<
    AvailableDevice[] | undefined
  >(undefined);
  const [selectedTransport, setSelectedTransport] = useState<
    TransportFactory | undefined
  >(undefined);

  useEffect(() => {
    if (!selectedTransport) {
      setAvailableDevices(undefined);
      return;
    }

    let ignore = false;

    if (selectedTransport.connect) {
      async function connectTransport() {
        try {
          const transport = await selectedTransport?.connect?.();

          if (!ignore) {
            if (transport) {
              onTransportCreated(transport);
            }
            setSelectedTransport(undefined);
          }
        } catch (e) {
          if (!ignore) {
            console.error(e);
            if (e instanceof Error && !(e instanceof UserCancelledError)) {
              alert(e.message);
            }
            setSelectedTransport(undefined);
          }
        }
      }

      connectTransport();
    } else {
      async function loadAvailableDevices() {
        const devices = await selectedTransport?.pick_and_connect?.list();

        if (!ignore) {
          setAvailableDevices(devices);
        }
      }

      loadAvailableDevices();
    }

    return () => {
      ignore = true;
    };
  }, [selectedTransport]);

  const connections = transports.map((t) => (
    <li key={t.label} className="list-none">
      <button
        className="bg-primary text-primary-content hover:opacity-90 rounded px-3 py-1.5 text-sm font-medium"
        type="button"
        onClick={async () => setSelectedTransport(t)}
      >
        Connect via {t.label}
      </button>
    </li>
  ));

  return (
    <div className="space-y-2">
      <p className="text-sm opacity-80">Select a connection type for live ZMK Studio RPC:</p>
      <ul className="flex gap-2 pt-1">{connections}</ul>
      {selectedTransport && availableDevices && (
        <ul className="space-y-1">
          {availableDevices.map((d) => (
            <li
              key={d.id}
              className="p-1.5 rounded bg-base-200 hover:bg-base-300 cursor-pointer text-sm"
              onClick={async () => {
                onTransportCreated(
                  await selectedTransport!.pick_and_connect!.connect(d)
                );
                setSelectedTransport(undefined);
              }}
            >
              {d.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function noTransportsOptionsPrompt() {
  return (
    <div className="my-2 flex flex-col gap-2 text-sm">
      <p>
        Live USB/BLE connection requires either{" "}
        <ExternalLink href="https://caniuse.com/web-serial">
          Web Serial
        </ExternalLink>{" "}
        (Chrome/Edge) or the VMK Studio Tauri desktop app.
      </p>
      <p className="text-xs opacity-75">
        You can still use Offline Mode to inspect snapshots, tune firmware parameters, edit DTS/keymap files, and run builds &amp; flashes.
      </p>
    </div>
  );
}

function connectOptions(
  transports: TransportFactory[],
  onTransportCreated: (t: RpcTransport) => void,
  open?: boolean
) {
  const useSimplePicker = useMemo(
    () => transports.every((t) => !t.pick_and_connect),
    [transports]
  );

  return useSimplePicker
    ? simpleDevicePicker(transports, onTransportCreated)
    : deviceList(open || false, transports, onTransportCreated);
}

export const ConnectModal = ({
  open,
  transports,
  onTransportCreated,
  onDismiss,
}: ConnectModalProps) => {
  const dialog = useModalRef(open || false, Boolean(onDismiss), true);

  const haveTransports = useMemo(() => transports.length > 0, [transports]);

  return (
    <GenericModal ref={dialog} className="max-w-xl w-full" onClose={onDismiss}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/vmk.png" alt="VMK Studio" className="h-7 w-7 rounded" />
            <h1 className="text-lg font-semibold">Connect to VMK Studio</h1>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1 rounded hover:bg-base-300"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {haveTransports
          ? connectOptions(transports, onTransportCreated, open)
          : noTransportsOptionsPrompt()}

        {onDismiss && (
          <div className="pt-3 border-t border-base-300 flex items-center justify-between gap-2">
            <span className="text-xs opacity-65">
              Need to tune firmware, edit files, or inspect snapshots?
            </span>
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 rounded bg-base-200 hover:bg-base-300 text-xs font-medium"
            >
              Continue Offline
            </button>
          </div>
        )}
      </div>
    </GenericModal>
  );
};

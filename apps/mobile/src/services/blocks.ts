// "Bloquer" / "Débloquer" from the thread and call-log menus: confirm, call the API, report back.
import { Alert } from "react-native";
import { api } from "../api/client";
import { toErrorKey } from "../api/errors";
import type { TKey, Vars } from "../i18n/core";
import { formatPhone } from "../lib/dial";

type T = (key: TKey, vars?: Vars) => string;

/** Asks for confirmation, then blocks or unblocks `peer`. Resolves with the message key to show. */
export function confirmBlockToggle(t: T, peer: string, blocked: boolean): Promise<TKey | null> {
  return new Promise((resolve) => {
    const number = formatPhone(peer);
    Alert.alert(
      t(blocked ? "blocks.unblock" : "blocks.block"),
      t(blocked ? "blocks.unblockConfirm" : "blocks.blockConfirm", { number }),
      [
        { text: t("common.cancel"), style: "cancel", onPress: () => resolve(null) },
        {
          text: t(blocked ? "blocks.unblock" : "blocks.block"),
          style: blocked ? "default" : "destructive",
          onPress: () => {
            const op = blocked ? api.unblockNumber(peer) : api.block({ number: peer });
            op.then(
              () => resolve(blocked ? "blocks.unblocked" : "blocks.blocked"),
              (e: unknown) => resolve(toErrorKey(e)),
            );
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

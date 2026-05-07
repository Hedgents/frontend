"use client";

import { MeshEvent } from "@/lib/api";
import { colorForMsgType, formatTime, shortConv, solscanTxUrl } from "@/lib/decode";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function EventCard({ event }: { event: MeshEvent }) {
  const [expanded, setExpanded] = useState(false);
  const colors = colorForMsgType(event.msg_type);
  const time = formatTime(event.ts_ms);
  const conv = shortConv(event.conv_id);
  return (
    <div
      className={cn("rounded-md p-2 cursor-pointer hover:bg-opacity-80 transition", colors.bg)}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <ChevronRight className={cn("w-3 h-3 mt-1 shrink-0 transition-transform", expanded && "rotate-90")} />
        <div className="text-xs font-mono opacity-50 shrink-0">{time}</div>
        <div className={cn("text-xs font-semibold uppercase tracking-wide shrink-0 px-1.5 rounded", colors.fg)}>
          {event.msg_type}
        </div>
        <div className="text-sm flex-1 leading-snug">{event.payload_summary}</div>
        {conv && <div className="text-xs font-mono opacity-40 shrink-0">#{conv}</div>}
      </div>
      {expanded && (
        <div className="mt-2 pl-7 space-y-1 text-xs">
          <div>
            <span className="opacity-50">role:</span> {event.sender_role}
          </div>
          <div>
            <span className="opacity-50">direction:</span> {event.direction}
          </div>
          {event.tx_signature && (
            <div>
              <span className="opacity-50">tx:</span>{" "}
              <a
                className="underline"
                href={solscanTxUrl(event.tx_signature)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {event.tx_signature.slice(0, 16)}…
              </a>
            </div>
          )}
          {event.payload_json && (
            <pre className="bg-black/5 dark:bg-white/5 rounded p-2 overflow-x-auto text-[10px]">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(event.payload_json), null, 2);
                } catch {
                  return event.payload_json;
                }
              })()}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

"use client";
import Image, { type ImageProps } from "next/image";
import { useRef, useState } from "react";

// Legacy external signed URLs retain their valid token while mounted. New
// stored photos use stable same-origin size-specific URLs across remounts too.
export function LotPhoto(props: ImageProps) {
 const source = typeof props.src === "string" ? props.src : null;
 const identity = source?.includes("/storage/v1/object/sign/") ? source.split("?")[0] : props.src;
 const retained = useRef({ identity, source: props.src, until: Date.now() + 50 * 60000 });
 const [failed, setFailed] = useState<string | null>(null);
 if (retained.current.identity !== identity || Date.now() >= retained.current.until || failed === String(retained.current.source)) retained.current = { identity, source: props.src, until: Date.now() + 50 * 60000 };
 return <Image loading={props.priority ? undefined : "lazy"} {...props} alt={props.alt} src={retained.current.source} onError={event => { if (retained.current.source !== props.src) setFailed(String(retained.current.source)); props.onError?.(event); }} />;
}

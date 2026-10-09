import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { announcementHtmlTree } from "@/lib/announcement-content";
import styles from "./html-content.module.css";

export function HtmlContent({ children }: { children: string }) {
  return (
    <div className={styles.content}>
      {toJsxRuntime(announcementHtmlTree(children), { Fragment, jsx, jsxs })}
    </div>
  );
}

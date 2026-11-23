export interface AppFooterProps {
  onShowAbout: () => void;
  onShowLicenseNotice: () => void;
  repoStatusLabel?: string;
}

export const AppFooter = ({
  onShowAbout,
  onShowLicenseNotice,
  repoStatusLabel,
}: AppFooterProps) => {
  return (
    <footer className="flex items-center justify-between gap-4 h-8 px-4 bg-background border-t border-border text-[11px] text-muted-foreground">
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        <span className="font-medium text-foreground shrink-0">VMK Studio</span>
        <span className="opacity-30 shrink-0">/</span>
        <span className="shrink-0">Fork of ZMK Studio</span>
        {repoStatusLabel && (
          <>
            <span className="opacity-30 shrink-0">/</span>
            <span className="font-mono text-foreground/80 truncate">
              {repoStatusLabel}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3.5 shrink-0 whitespace-nowrap">
        <a
          href="https://www.rareui.com"
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground transition-colors"
        >
          UI by Rare UI
        </a>
        <button
          type="button"
          className="hover:text-foreground transition-colors cursor-pointer"
          onClick={onShowAbout}
        >
          About
        </button>
        <button
          type="button"
          className="hover:text-foreground transition-colors cursor-pointer"
          onClick={onShowLicenseNotice}
        >
          License
        </button>
      </div>
    </footer>
  );
};

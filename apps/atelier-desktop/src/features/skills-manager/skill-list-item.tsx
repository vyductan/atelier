import { Download, ExternalLink, Sparkles } from "lucide-react";
import type { Skill } from "../../lib/skills-client";

interface SkillListItemProps {
  skill: Skill;
  onInstall: (skill: Skill) => void;
}

// Generate a pseudo-random color based on string
const getAvatarColor = (name: string) => {
  const colors = [
    "bg-red-500/10 text-red-500 border-red-500/20",
    "bg-blue-500/10 text-blue-500 border-blue-500/20",
    "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    "bg-violet-500/10 text-violet-500 border-violet-500/20",
    "bg-amber-500/10 text-amber-500 border-amber-500/20",
    "bg-pink-500/10 text-pink-500 border-pink-500/20",
    "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (name.codePointAt(i) || 0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

export function SkillListItem({ skill, onInstall }: SkillListItemProps) {
  const colorClass = getAvatarColor(skill.name);
  const initial = skill.name.charAt(0).toUpperCase();

  return (
    <div className="group relative flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border font-bold ${colorClass}`}
        >
          {initial}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold tracking-tight">{skill.name}</h3>
            <div className="flex items-center gap-1 font-medium">
              <Download className="h-3.5 w-3.5" />
              <span>{new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(skill.installs)}</span>
            </div>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={skill.source}>
            {skill.source}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-2 flex items-center justify-between border-t pt-4">
        <button
          onClick={() => window.open(`https://skills.sh/${skill.source}`, "_blank")}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View Details
        </button>
        <button
          onClick={() => onInstall(skill)}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow active:scale-95"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Install
        </button>
      </div>
    </div>
  );
}

"use client"

import { use } from "react"
import { PosterEditorContainer } from "@/components/PosterEditorContainer"
import { parseItemParam } from "@/lib/parse-item-param"

export default function SpatialPostersSlugPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const resolvedParams = use(params)
  const slug = resolvedParams.slug || []

  let parsed = null
  if (slug.length >= 2) {
    parsed = parseItemParam(slug[0], slug[1])
  } else if (slug.length === 1) {
    parsed = parseItemParam(slug[0])
  }

  if (!parsed) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <p className="text-sm text-zinc-400">Poster item not found</p>
      </div>
    )
  }

  return <PosterEditorContainer id={parsed.id} mediaType={parsed.media_type} />
}

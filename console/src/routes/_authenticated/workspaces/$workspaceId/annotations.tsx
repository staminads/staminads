import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { workspaceQueryOptions } from '../../../../lib/queries'
import { AnnotationsSettings } from '../../../../components/settings/AnnotationsSettings'

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/annotations')({
  component: Annotations,
})

function Annotations() {
  const { workspaceId } = Route.useParams()
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))

  return (
    <div className="p-6">
      <AnnotationsSettings workspace={workspace} />
    </div>
  )
}

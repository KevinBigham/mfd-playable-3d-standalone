'use client'

import { useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import * as THREE from 'three'
import { stadiumPerimeterPoint } from '../perimeter'
import {
  compilePreviewProfile,
  goalpostPreviewCoordinates,
  perimeterPreviewTransform,
  previewRoofTransform,
  protectedFieldPreviewVolumes,
  skylinePreviewParts,
  verticalCenterYd,
  type GoalpostPreview,
  type PreviewRoofTransform,
} from '../preview-coordinates'
import { yardsToMetres } from '../units'
import {
  MFD_STADIUM_KINDS,
  type MfdBannerNode,
  type MfdBowlOpeningNode,
  type MfdBowlPlanNode,
  type MfdDeckProfileNode,
  type MfdFieldReferenceNode,
  type MfdLightTowerNode,
  type MfdRoofNode,
  type MfdScoreboardNode,
  type MfdSkylinePropNode,
  type MfdStudioNode,
  type MfdTunnelNode,
} from './schemas'

const COLORS = {
  field: '#315f36',
  protected: '#ff3b5c',
  bowl: '#56c7d9',
  seats: '#7898a5',
  structure: '#56606b',
  signage: '#30b8cc',
  accent: '#ffb454',
  outer: '#303943',
  ground: '#777065',
  dark: '#1d2329',
} as const

function currentPlan(nodes: Record<string, unknown>): MfdBowlPlanNode | null {
  for (const node of Object.values(nodes)) {
    if ((node as { type?: string })?.type === MFD_STADIUM_KINDS.bowlPlan) return node as MfdBowlPlanNode
  }
  return null
}

function loopGeometry(plan: MfdBowlPlanNode, expansionYd = 0, yYd = 0): THREE.BufferGeometry {
  const points: THREE.Vector3[] = []
  const nativePlan = {
    centerZ: plan.centerZYd,
    halfX: plan.halfXYd,
    halfZ: plan.halfZYd,
    cornerRadius: plan.cornerRadiusYd,
    aisleEvery: plan.aisleEvery,
    profile: [],
  }
  for (let index = 0; index < 128; index++) {
    const point = stadiumPerimeterPoint(nativePlan, index / 128)
    points.push(new THREE.Vector3(
      yardsToMetres(point.x + point.nx * expansionYd),
      yardsToMetres(yYd),
      yardsToMetres(point.z + point.nz * expansionYd),
    ))
  }
  return new THREE.BufferGeometry().setFromPoints(points)
}

function FieldReference({ node }: { node: MfdFieldReferenceNode }) {
  if (node.cameraPreset !== 'none' || !node.visible) return null
  const fieldWidth = yardsToMetres(node.fieldHalfWidthYd * 2)
  const fieldLength = yardsToMetres(node.fieldLengthYd + node.endZoneDepthYd * 2)
  const centerZ = yardsToMetres(node.fieldLengthYd / 2)
  const protectedVolumes = protectedFieldPreviewVolumes(node)
  const goals = goalpostPreviewCoordinates(node)
  return (
    <group>
      <mesh position={[0, 0.015, centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[fieldWidth, fieldLength]} />
        <meshStandardMaterial color={COLORS.field} opacity={0.72} transparent />
      </mesh>
      {node.protectedEnvelope && (
        <group>
          {protectedVolumes.map((volume) => (
            <mesh key={volume.id} position={volume.center.map(yardsToMetres) as [number, number, number]}>
              <boxGeometry args={volume.size.map(yardsToMetres) as [number, number, number]} />
              <meshBasicMaterial color={COLORS.protected} depthWrite={false} opacity={0.08} transparent wireframe />
            </mesh>
          ))}
        </group>
      )}
      {goals.map((goal) => <Goalpost key={goal.id} goal={goal} supportOffsetYd={node.goalSupportOffsetYd} />)}
      {[-node.fieldHalfWidthYd, node.fieldHalfWidthYd].map((x) => (
        <mesh key={x} position={[yardsToMetres(x), 0.035, centerZ]}>
          <boxGeometry args={[0.045, 0.025, fieldLength]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
      {[-node.endZoneDepthYd, 0, node.fieldLengthYd, node.fieldLengthYd + node.endZoneDepthYd].map((z) => (
        <mesh key={z} position={[0, 0.04, yardsToMetres(z)]}>
          <boxGeometry args={[fieldWidth, 0.025, 0.045]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  )
}

function Goalpost({ goal, supportOffsetYd }: { goal: GoalpostPreview; supportOffsetYd: number }) {
  const back = goal.id === 'home' ? -1 : 1
  const curve = useMemo(() => {
    const points: THREE.Vector3[] = []
    for (let index = 0; index <= 9; index++) {
      const t = index / 9
      const angle = t * Math.PI / 2
      points.push(new THREE.Vector3(
        0,
        yardsToMetres(goal.crossbarCenter[1] - 0.55 + Math.sin(angle) * 0.55),
        yardsToMetres(goal.baseZ - back * (1 - Math.cos(angle)) * supportOffsetYd),
      ))
    }
    return new THREE.CatmullRomCurve3(points)
  }, [back, goal.baseZ, goal.crossbarCenter, supportOffsetYd])
  const yellow = '#ffd21e'
  return (
    <group>
      <mesh position={[0, yardsToMetres(0.95), yardsToMetres(goal.baseZ)]}>
        <cylinderGeometry args={[yardsToMetres(0.34), yardsToMetres(0.38), yardsToMetres(1.9), 10]} />
        <meshStandardMaterial color="#1b1f26" />
      </mesh>
      <mesh position={goal.supportCenter.map(yardsToMetres) as [number, number, number]}>
        <cylinderGeometry args={[yardsToMetres(0.17), yardsToMetres(0.17), yardsToMetres(goal.supportLength), 10]} />
        <meshStandardMaterial color="#c99b10" />
      </mesh>
      <mesh>
        <tubeGeometry args={[curve, 18, yardsToMetres(0.15), 10, false]} />
        <meshStandardMaterial color="#c99b10" />
      </mesh>
      <mesh position={goal.crossbarCenter.map(yardsToMetres) as [number, number, number]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[yardsToMetres(0.14), yardsToMetres(0.14), yardsToMetres(goal.crossbarLength), 10]} />
        <meshStandardMaterial color={yellow} />
      </mesh>
      {goal.uprightCenters.map((center, index) => (
        <mesh key={index} position={center.map(yardsToMetres) as [number, number, number]}>
          <cylinderGeometry args={[yardsToMetres(0.115), yardsToMetres(0.115), yardsToMetres(goal.uprightLength), 10]} />
          <meshStandardMaterial color={yellow} />
        </mesh>
      ))}
    </group>
  )
}

function BowlPlan({ node }: { node: MfdBowlPlanNode }) {
  const geometry = useMemo(
    () => loopGeometry(node),
    [node.centerZYd, node.halfXYd, node.halfZYd, node.cornerRadiusYd, node.aisleEvery],
  )
  return (
    <lineLoop geometry={geometry as never}>
      <lineBasicMaterial color={COLORS.bowl} linewidth={2} />
    </lineLoop>
  )
}

function DeckProfile({ node }: { node: MfdDeckProfileNode }) {
  const nodes = useScene((state) => state.nodes) as unknown as Record<string, unknown>
  const plan = currentPlan(nodes)
  const profiles = Object.values(nodes)
    .filter((item) => (item as { type?: string }).type === MFD_STADIUM_KINDS.deckProfile)
    .map((item) => item as MfdDeckProfileNode)
  const segment = compilePreviewProfile(profiles).profile.find((item) => item.id === node.id)
  const startGeometry = useMemo(
    () => plan && segment ? loopGeometry(plan, segment.r0, segment.y0) : new THREE.BufferGeometry(),
    [plan?.centerZYd, plan?.halfXYd, plan?.halfZYd, plan?.cornerRadiusYd, segment?.r0, segment?.y0],
  )
  const endGeometry = useMemo(
    () => plan && segment ? loopGeometry(plan, segment.r1, segment.y1) : new THREE.BufferGeometry(),
    [plan?.centerZYd, plan?.halfXYd, plan?.halfZYd, plan?.cornerRadiusYd, segment?.r1, segment?.y1],
  )
  if (!plan || !segment) return null
  return (
    <group>
      <lineLoop geometry={startGeometry as never}>
        <lineBasicMaterial color={COLORS[node.role]} opacity={0.35} transparent />
      </lineLoop>
      <lineLoop geometry={endGeometry as never}>
        <lineBasicMaterial color={COLORS[node.role]} />
      </lineLoop>
    </group>
  )
}

function perimeterTransform(plan: MfdBowlPlanNode, t: number, outwardYd: number) {
  const transform = perimeterPreviewTransform({
    centerZ: plan.centerZYd,
    halfX: plan.halfXYd,
    halfZ: plan.halfZYd,
    cornerRadius: plan.cornerRadiusYd,
    aisleEvery: plan.aisleEvery,
    profile: [],
  }, t, outwardYd)
  return {
    position: [yardsToMetres(transform.xYd), 0, yardsToMetres(transform.zYd)] as [number, number, number],
    rotation: [0, transform.yaw, 0] as [number, number, number],
  }
}

function useBowlPlan(): MfdBowlPlanNode | null {
  const nodes = useScene((state) => state.nodes) as unknown as Record<string, unknown>
  return currentPlan(nodes)
}

function useCompiledProfile() {
  const nodes = useScene((state) => state.nodes) as unknown as Record<string, unknown>
  return compilePreviewProfile(Object.values(nodes)
    .filter((item) => (item as { type?: string }).type === MFD_STADIUM_KINDS.deckProfile)
    .map((item) => item as MfdDeckProfileNode))
}

function Opening({ node }: { node: MfdBowlOpeningNode }) {
  const plan = useBowlPlan()
  if (!plan) return null
  const t = (node.startT + node.endT) / 2
  const spanYd = Math.max(3, (node.endT - node.startT) * (plan.halfXYd + plan.halfZYd) * 2)
  const transform = perimeterTransform(plan, t, 0)
  return (
    <mesh position={transform.position} rotation={transform.rotation}>
      <boxGeometry args={[yardsToMetres(spanYd), yardsToMetres(7), yardsToMetres(1)]} />
      <meshBasicMaterial color={COLORS.protected} opacity={0.24} transparent wireframe />
    </mesh>
  )
}

function roofShellGeometry(preview: PreviewRoofTransform | null): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  if (!preview) return geometry
  const positions: number[] = []
  const addQuad = (quad: PreviewRoofTransform['segments'][number]['top'], reverse = false) => {
    const indices = reverse ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]
    for (const index of indices) {
      const point = quad[index]
      positions.push(yardsToMetres(point[0]), yardsToMetres(point[1]), yardsToMetres(point[2]))
    }
  }
  for (const segment of preview.segments) {
    addQuad(segment.top)
    addQuad(segment.underside, true)
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function Roof({ node }: { node: MfdRoofNode }) {
  const plan = useBowlPlan()
  const { topR } = useCompiledProfile()
  const nodes = useScene((state) => state.nodes) as unknown as Record<string, unknown>
  const openings = Object.values(nodes)
    .filter((item) => (item as { type?: string }).type === MFD_STADIUM_KINDS.bowlOpening)
    .map((item) => item as MfdBowlOpeningNode)
    .sort((a, b) => a.startT - b.startT || a.id.localeCompare(b.id))
  const openingKey = openings.map((opening) => `${opening.startT}:${opening.endT}`).join('|')
  const preview = useMemo(() => plan ? previewRoofTransform({
    centerZ: plan.centerZYd,
    halfX: plan.halfXYd,
    halfZ: plan.halfZYd,
    cornerRadius: plan.cornerRadiusYd,
  }, node, topR, openings, 128) : null, [
    plan?.centerZYd, plan?.halfXYd, plan?.halfZYd, plan?.cornerRadiusYd,
    node.style, node.coverage, node.heightYd, node.radialOverhangYd, topR, openingKey,
  ])
  const geometry = useMemo(() => roofShellGeometry(preview), [preview])
  if (!preview) return null
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#66798b" opacity={0.42} side={THREE.DoubleSide} transparent wireframe />
      </mesh>
      {preview.panel && (
        <mesh
          position={preview.panel.center.map(yardsToMetres) as [number, number, number]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={preview.panel.size.map(yardsToMetres) as [number, number]} />
          <meshStandardMaterial color="#202936" opacity={0.38} side={THREE.DoubleSide} transparent wireframe />
        </mesh>
      )}
    </group>
  )
}

function Tunnel({ node }: { node: MfdTunnelNode }) {
  const plan = useBowlPlan()
  if (!plan) return null
  const transform = perimeterTransform(plan, node.perimeterT, -0.12)
  transform.position[1] = yardsToMetres(node.heightYd / 2)
  return (
    <mesh position={transform.position} rotation={transform.rotation}>
      <boxGeometry args={[yardsToMetres(node.widthYd), yardsToMetres(node.heightYd), yardsToMetres(4)]} />
      <meshStandardMaterial color="#15191d" opacity={0.9} transparent />
    </mesh>
  )
}

function Scoreboard({ node }: { node: MfdScoreboardNode }) {
  const plan = useBowlPlan()
  if (!plan) return null
  const transform = perimeterTransform(plan, node.perimeterT, node.outwardOffsetYd)
  transform.position[1] = yardsToMetres(verticalCenterYd(node.elevationYd, node.heightYd))
  return (
    <mesh position={transform.position} rotation={transform.rotation}>
      <boxGeometry args={[yardsToMetres(node.widthYd), yardsToMetres(node.heightYd), yardsToMetres(1.5)]} />
      <meshStandardMaterial color="#17212b" emissive="#1a7b8a" emissiveIntensity={0.35} />
    </mesh>
  )
}

function LightTower({ node }: { node: MfdLightTowerNode }) {
  const plan = useBowlPlan()
  const { topY } = useCompiledProfile()
  if (!plan) return null
  const transform = perimeterTransform(plan, node.perimeterT, node.outwardOffsetYd)
  transform.position[1] = yardsToMetres(topY)
  const mastHeight = Math.max(1, node.heightYd - 1)
  return (
    <group position={transform.position} rotation={transform.rotation}>
      {[-1.5, 1.5].map((x) => (
        <mesh key={x} position={[yardsToMetres(x), yardsToMetres(mastHeight * 0.5), 0]}>
          <boxGeometry args={[yardsToMetres(0.5), yardsToMetres(mastHeight), yardsToMetres(0.5)]} />
          <meshStandardMaterial color="#606a73" />
        </mesh>
      ))}
      <mesh position={[0, yardsToMetres(node.heightYd - 0.1), yardsToMetres(-0.4)]}>
        <boxGeometry args={[yardsToMetres(7.2), yardsToMetres(2.2), yardsToMetres(0.7)]} />
        <meshStandardMaterial color="#fff4ca" emissive="#fff0ad" emissiveIntensity={0.5} />
      </mesh>
    </group>
  )
}

function Banner({ node }: { node: MfdBannerNode }) {
  const plan = useBowlPlan()
  const { topR } = useCompiledProfile()
  if (!plan) return null
  const transform = perimeterTransform(plan, node.perimeterT, topR + 0.35)
  transform.position[1] = yardsToMetres(verticalCenterYd(node.elevationYd, node.heightYd))
  return (
    <mesh position={transform.position} rotation={transform.rotation}>
      <boxGeometry args={[yardsToMetres(node.widthYd), yardsToMetres(node.heightYd), yardsToMetres(0.25)]} />
      <meshStandardMaterial color={node.colorRole === 'accent' ? COLORS.accent : '#d5d0c6'} />
    </mesh>
  )
}

function Skyline({ node }: { node: MfdSkylinePropNode }) {
  const color = node.colorRole === 'accent' ? COLORS.accent
    : node.colorRole === 'dark' ? COLORS.dark
      : node.colorRole === 'structure' ? COLORS.structure : '#a8a294'
  return <group>{skylinePreviewParts(node).map((part) => (
    <mesh key={part.id} position={part.center.map(yardsToMetres) as [number, number, number]}>
      <boxGeometry args={part.size.map(yardsToMetres) as [number, number, number]} />
      <meshStandardMaterial color={color} opacity={0.65} transparent wireframe={node.minQuality !== 'LOW'} />
    </mesh>
  ))}</group>
}

export default function MfdSemanticRenderer({ node }: { node: MfdStudioNode }) {
  switch (node.type) {
    case MFD_STADIUM_KINDS.fieldReference: return <FieldReference node={node} />
    case MFD_STADIUM_KINDS.bowlPlan: return <BowlPlan node={node} />
    case MFD_STADIUM_KINDS.deckProfile: return <DeckProfile node={node} />
    case MFD_STADIUM_KINDS.bowlOpening: return <Opening node={node} />
    case MFD_STADIUM_KINDS.roof: return <Roof node={node} />
    case MFD_STADIUM_KINDS.tunnel: return <Tunnel node={node} />
    case MFD_STADIUM_KINDS.scoreboard: return <Scoreboard node={node} />
    case MFD_STADIUM_KINDS.lightTower: return <LightTower node={node} />
    case MFD_STADIUM_KINDS.banner: return <Banner node={node} />
    case MFD_STADIUM_KINDS.skylineProp: return <Skyline node={node} />
    default: return null
  }
}

const qualificationNames: Record<string, string> = {
  'TRN-FAB-01': '3D printer safety training',
  'TRN-MED-01': 'medical equipment safety training',
  'TRN-ROB-01': 'robotics lab safety training',
}

export const getQualificationName = (code: string | null | undefined): string => {
  if (!code) return 'safety training'
  return qualificationNames[code] ?? 'the required safety training'
}

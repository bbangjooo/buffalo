"""Small personal support sculptures with broad, deliberately folded planes.

Coordinates use Three.js axes. Each object rests on the shared .24 m plinth,
with a real silhouette and substantial depth beneath the reader opening.
"""
from math import cos, sin, pi


def _horizontal_profile(kit, name, x, z, profile, token, n=10):
    """Revolve a closed radial section into visible flat, unsmoothed panels.

    The section runs from the outer underside up and inward, allowing a real
    hollow cup or raised saucer edge without overlapping solid cylinders.
    """
    points = []
    for radius, y in profile:
        for i in range(n):
            angle = 2*pi*i/n + pi/n
            points.append((x+radius*cos(angle), y, z+radius*sin(angle)))
    faces = []
    for row in range(len(profile)-1):
        for i in range(n):
            j = (i+1) % n
            # +Y in Three.js is up; increasing X/Z angle winds downward.
            faces.append((row*n+i, (row+1)*n+i, (row+1)*n+j, row*n+j))
    faces.extend([tuple(range(n)), tuple(reversed(range((len(profile)-1)*n, len(profile)*n)))])
    return kit.poly(name, points, faces, token, orient=False)


def _coffee(kit, station):
    # The saucer uses a broad sloping edge and inset centre. Its noncircular
    # footprint feels hand made and leaves space for the loop handle.
    saucer = _horizontal_profile(kit, 'Coffee AngularSaucer', 0, 0,
        [(.62,.251),(.74,.281),(.80,.336),(.75,.36),(.54,.315),(.03,.315)],
        'teal', n=10)
    for vertex in saucer.data.vertices:
        # Blender local Y corresponds to negative Three.js Z.
        vertex.co.y *= .60

    # A six-sided open loop: both sides and the inside wall are actual faces.
    # The attached left edge is buried in the mug, never a floating torus.
    outer = [(.10,.49),(.54,.49),(.80,.65),(.80,.90),(.56,1.047),(.12,1.027)]
    inner = [(.21,.633),(.49,.633),(.64,.727),(.64,.826),(.49,.914),(.21,.914)]
    points = [(x,y,z) for z in (-.083,.083) for ring in (outer,inner) for x,y in ring]
    faces = []
    n=len(outer)
    for i in range(n):
        j=(i+1)%n
        faces.extend([(i,j,j+2*n,i+2*n),
                      (i+2*n,j+2*n,j+3*n,i+3*n),
                      (i+3*n,j+3*n,j+n,i+n),
                      (i+n,j+n,j,i)])
    kit.poly('Coffee SubstantialLoopHandle',points,faces,'paper',orient=False)

    # One closed radial section provides an actual thick ceramic lip, a
    # recessed inner wall, tapered outer panels, and a quiet chamfered foot.
    _horizontal_profile(kit, 'Coffee FacetedCeramicMug', -.16, 0,
        [(.267,.316),(.30,.366),(.37,.442),(.402,1.071),
         (.375,1.118),(.321,1.118),(.307,1.064),(.269,.421),(.02,.421)],
        'paper', n=10)
    kit.cylinder('Coffee RecessedDarkBrew',(-.16,1.043,0),.304,.014,
                 'walnut',n=10,phase=pi/10)
    # One angular highlight makes the brew legible; it is deliberately sparse.
    kit.poly('Coffee BrewReflection',[(-.332,1.051,.105),(-.253,1.051,.186),
             (-.144,1.051,.207),(-.219,1.051,.161),(-.292,1.051,.097)],
             [(0,1,2,3,4)],'wood',tones=[.72],orient=False)


def build(shape, kit, station):
    """Create a support sculpture, returning False for another module's shape."""
    if shape == 'coffee':
        _coffee(kit, station)
    else:
        return False
    return True

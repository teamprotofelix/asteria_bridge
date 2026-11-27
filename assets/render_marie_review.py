"""Optional Blender 4.x studio render of the versioned GLB."""
import math
import os
from pathlib import Path

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str((Path(__file__).resolve().parent / 'crew' / 'marie.glb')))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 12
scene.cycles.use_denoising = False
scene.render.resolution_x = 460
scene.render.resolution_y = 620
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
world = scene.world = bpy.data.worlds.new('Studio')
world.use_nodes = True
world.node_tree.nodes.get('Background').inputs[0].default_value = (.055,.085,.13,1)
world.node_tree.nodes.get('Background').inputs[1].default_value = .55
def target(item, point):
    item.rotation_euler = (Vector(point)-item.location).to_track_quat('-Z','Y').to_euler()
for name,position,power,color,scale in [
    ('Key',(1.6,-2.7,3.1),310,(1,.86,.76),3.0),
    ('Fill',(-2.6,1.8,2.4),210,(.75,.87,1),2.8),
    ('Rim',(.2,2.5,3.5),300,(.69,.91,1),2.9),
]:
    light = bpy.data.lights.new(name,'AREA')
    figure = bpy.data.objects.new(name,light)
    scene.collection.objects.link(figure)
    figure.location = position
    light.energy = power
    light.color = color
    light.shape = 'DISK'
    light.size = scale
    target(figure, (0,0,.95))
cam_data = bpy.data.cameras.new('Portrait')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.04
cam = bpy.data.objects.new('Portrait',cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
out = Path(os.environ.get('MARIE_STUDIO_DIR', 'marie-turnaround')).resolve()
out.mkdir(exist_ok=True)
for name,angle in [('front',0),('three-quarter',32),('side',90),('rear',180)]:
    a=math.radians(angle)
    cam.location=(3*math.sin(a),3*math.cos(a),1.1)
    target(cam,(0,0,.87))
    scene.render.filepath=str(out/(name+'.png'))
    bpy.ops.render.render(write_still=True)
print('GLB review:', len(bpy.data.actions), 'clips', len(bpy.data.armatures), 'armature')

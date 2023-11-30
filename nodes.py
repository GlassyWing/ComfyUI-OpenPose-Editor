import glob
import os.path
import random
import shutil

import torch

import folder_paths
from nodes import LoadImage
import numpy as np
from PIL import Image


class OpenPoseEditor:

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {
            "backgrounds": ("IMAGE",),
            # Require to link openpose node, this make js know which openpose node to link
            "openpose_images": ("IMAGE",),
            "image": ("STRING", {"default": ""})},
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "load_image"

    CATEGORY = "image"

    def __init__(self):
        self.cache_img = None
        self.prefix_append = "_temp_" + ''.join(random.choice("abcdefghijklmnopqrstupvxyz") for x in range(5))
        self.temp_subfolder = "open_pose_editor_images"
        self.output_dir = folder_paths.get_temp_directory()
        self.clear_cache_images()

    def clear_cache_images(self):
        for img_path in glob.glob(os.path.join(folder_paths.get_input_directory(), "*.png")):
            if "OpenPose" in img_path:
                os.remove(img_path)

    def save_backgrounds(self, images, filename_prefix="ComfyUI"):
        filename_prefix += self.prefix_append
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0])
        results = list()
        for image in images:
            i = 255. * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            metadata = None

            file = f"{filename}_{counter:05}_.png"
            img.save(os.path.join(full_output_folder, file), pnginfo=metadata, compress_level=4)
            results.append({
                "filename": file,
                "subfolder": subfolder,
                "type": "temp"
            })
            counter += 1

        return results

    def save_image(self, image, image_path):
        image = 255. * image.cpu().numpy()
        img = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
        img.save(image_path)

    def load_image(self, backgrounds, openpose_images, image):
        pose_image_path = image

        save_info = self.save_backgrounds(backgrounds)

        if pose_image_path is not None and pose_image_path != "":
            pose_images = []
            pose_image_prefix = pose_image_path[:pose_image_path.rindex("_")]

            for i in range(len(openpose_images)):
                image_path = folder_paths.get_annotated_filepath(f"{pose_image_prefix}_{i}.png")
                if os.path.exists(image_path):
                    pose_image, _ = LoadImage.load_image(self, f"{pose_image_prefix}_{i}.png")
                else:
                    self.save_image(openpose_images[i], image_path)
                    pose_image = openpose_images[i][None]
                pose_images.append(pose_image)
            out = torch.cat(pose_images, 0)
        else:
            # For first run, the image_path param has not been assigned.
            out = openpose_images

        result = {
            "ui": {"backgrounds": save_info},
            "result": (out,)
        }
        return result


NODE_CLASS_MAPPINGS = {
    "Nui.OpenPoseEditor": OpenPoseEditor
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Nui.OpenPoseEditor": "OpenPose Editor",
}

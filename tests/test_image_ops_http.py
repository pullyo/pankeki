"""Real HTTP boundary, isolated ephemeral server, no live Pankeki/Comfy calls."""
import base64
import hashlib
import json
import unittest
import threading
from unittest.mock import patch
import tests.test_server as fixture


class ImageOpsHTTPTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture.ServerTests('runTest'); self.fixture.setUp()
        self.raw=fixture.png(fixture.Image.new('RGBA',(2,3),(10,20,30,255)))

    def tearDown(self):
        self.fixture.tearDown()

    def body(self):
        return {'version':1,'operationId':'op-1','operation':'resize','source':{'png':'data:image/png;base64,'+base64.b64encode(self.raw).decode(),'sha256':hashlib.sha256(self.raw).hexdigest(),'width':2,'height':3},'options':{'width':4,'height':6,'keepAspect':True}}

    def request(self,body,headers=None):
        status,_,raw=self.fixture.request('POST','/api/image-ops',body,headers=headers)
        return status,json.loads(raw)

    def test_unknown_fields_path_urls_hash_or_size_mismatch_are_rejected(self):
        for change in [lambda b:b.update(path='/tmp/x'),lambda b:b['source'].update(png='file:///tmp/x'),lambda b:b['source'].update(sha256='0'*64),lambda b:b['source'].update(width=8),lambda b:b['options'].update(width=True),lambda b:b['options'].update(width=8193),lambda b:b['options'].update(height=5),lambda b:b['options'].update(command='run')]:
            body=self.body();change(body)
            status,out=self.request(body)
            self.assertEqual(status,400);self.assertFalse(out['ok']);self.assertEqual(out['code'],'invalid-input')

    def test_cross_origin_rejected_before_image_operation(self):
        status,_=self.request(self.body(),{'Origin':'https://example.com'})
        self.assertEqual(status,400)

    def test_success_is_actual_png_hash_and_dimensions(self):
        import pankeki.server as server
        self.assertTrue(callable(getattr(server,'perform_image_op',None)),'image-ops HTTP execution is missing')
        output=fixture.png(fixture.Image.new('RGBA',(4,6),(1,2,3,100)))
        with patch.object(server,'perform_image_op',return_value=(output,{'algorithm':'test-resize','algorithmVersion':'1','parameters':{'width':4,'height':6,'keepAspect':True}})):
            status,out=self.request(self.body())
        self.assertEqual(status,200);self.assertTrue(out['ok']);self.assertEqual(out['operationId'],'op-1')
        self.assertEqual(out['image']['width'],4);self.assertEqual(out['image']['height'],6)
        self.assertEqual(out['image']['sha256'],hashlib.sha256(output).hexdigest())
        self.assertEqual(base64.b64decode(out['image']['png'].split(',')[1]),output)

    def test_failed_operation_never_reports_success_or_leaks_paths(self):
        import pankeki.server as server
        self.assertTrue(callable(getattr(server,'perform_image_op',None)),'image-ops execution is missing')
        with patch.object(server,'perform_image_op',side_effect=RuntimeError('/private/secret/model')):
            status,out=self.request(self.body())
        self.assertEqual(status,500);self.assertFalse(out['ok']);self.assertEqual(out['code'],'operation-failed');self.assertNotIn('/private',json.dumps(out))

    def test_encoded_image_limit_has_a_rich_413_error(self):
        body=self.body();body['source']['png']='data:image/png;base64,'+'A'*(16*1024*1024)
        status,out=self.request(body)
        self.assertEqual(status,413);self.assertFalse(out['ok']);self.assertEqual(out['code'],'size-limit')

    def test_declared_body_over_32_mib_is_rejected_without_reading_it(self):
        status,_,raw=self.fixture.request('POST','/api/image-ops',raw=b'{}',headers={'Content-Length':str(32*1024*1024+1)})
        self.assertEqual(status,413);self.assertEqual(json.loads(raw)['code'],'size-limit')

    def test_second_operation_is_busy_and_first_result_keeps_its_identity(self):
        import pankeki.server as server
        entered,release=threading.Event(),threading.Event();first=[]
        output=fixture.png(fixture.Image.new('RGBA',(4,6),(1,2,3,100)))
        def run(*args):
            entered.set();release.wait(2)
            return output,{'algorithm':'test','algorithmVersion':'1','parameters':{}}
        with patch.object(server,'perform_image_op',side_effect=run):
            thread=threading.Thread(target=lambda:first.append(self.request(self.body())));thread.start()
            self.assertTrue(entered.wait(1));body=self.body();body['operationId']='second'
            try:
                status,out=self.request(body);self.assertEqual(status,409);self.assertEqual(out['code'],'busy')
            finally:release.set();thread.join(2)
        self.assertEqual(first[0][0],200);self.assertEqual(first[0][1]['operationId'],'op-1')

    def test_real_resize_uses_exact_half_up_locked_pixels_and_preserves_alpha(self):
        body=self.body();body['options']={'width':3,'height':5,'keepAspect':True}
        status,out=self.request(body)
        self.assertEqual(status,200,out);self.assertEqual((out['image']['width'],out['image']['height']),(3,5))
        image=fixture.Image.open(fixture.io.BytesIO(base64.b64decode(out['image']['png'].split(',')[1])))
        self.assertEqual(image.size,(3,5));self.assertEqual(image.convert('RGBA').getextrema()[3],(255,255))

    def test_ratio_lock_accepts_height_anchor_half_up_and_keeps_exact_pixels(self):
        body=self.body();source=fixture.png(fixture.Image.new('RGBA',(3,100),(10,20,30,255)))
        body['source']={'png':'data:image/png;base64,'+base64.b64encode(source).decode(),'sha256':hashlib.sha256(source).hexdigest(),'width':3,'height':100}
        for width,height in [(2,50),(1,25),(6,200)]:
            with self.subTest(width=width,height=height):
                body['options']={'width':width,'height':height,'keepAspect':True}
                status,out=self.request(body);self.assertEqual(status,200,out)
                image=fixture.Image.open(fixture.io.BytesIO(base64.b64decode(out['image']['png'].split(',')[1])))
                self.assertEqual(image.size,(width,height));self.assertEqual(out['metadata']['parameters'],body['options'])

    def test_ratio_lock_rejects_pairs_which_neither_client_anchor_can_produce(self):
        body=self.body();source=fixture.png(fixture.Image.new('RGBA',(3,100),(10,20,30,255)))
        body['source']={'png':'data:image/png;base64,'+base64.b64encode(source).decode(),'sha256':hashlib.sha256(source).hexdigest(),'width':3,'height':100}
        for width,height in [(4,50),(3,80)]:
            with self.subTest(width=width,height=height):
                body['options']={'width':width,'height':height,'keepAspect':True}
                status,out=self.request(body);self.assertEqual(status,400);self.assertEqual(out['code'],'invalid-input')

    def test_real_markup_changes_only_the_drawn_natural_pixel(self):
        body=self.body();body['operation']='markup';body['options']={'strokes':[{'points':[{'x':0,'y':1}],'color':'#FF0000','width':1,'opacity':1}]}
        status,out=self.request(body);self.assertEqual(status,200,out)
        image=fixture.Image.open(fixture.io.BytesIO(base64.b64decode(out['image']['png'].split(',')[1]))).convert('RGBA')
        self.assertNotEqual(image.getpixel((0,1)),(10,20,30,255));self.assertEqual(image.getpixel((1,2)),(10,20,30,255))

    def test_real_alpha_composition_uses_supplied_matte_and_original_rgb(self):
        import pankeki.server as server
        matte=fixture.Image.new('L',(2,3),0);matte.putpixel((1,1),255);matte.putpixel((0,1),128)
        body=self.body();body['operation']='background-remove';body['options']={}
        with patch.object(server,'foreground_mask',return_value=fixture.png(matte)):
            status,out=self.request(body)
        self.assertEqual(status,200,out)
        image=fixture.Image.open(fixture.io.BytesIO(base64.b64decode(out['image']['png'].split(',')[1]))).convert('RGBA')
        self.assertEqual(image.getpixel((0,0)),(10,20,30,0));self.assertEqual(image.getpixel((0,1)),(10,20,30,128));self.assertEqual(image.getpixel((1,1)),(10,20,30,255))

    def test_markup_limits_match_the_real_bounded_renderer(self):
        body=self.body();body['operation']='markup';body['options']={'strokes':[{'points':[{'x':0,'y':0}],'color':'#FF0000','width':1,'opacity':1}]*129}
        status,out=self.request(body);self.assertEqual(status,400);self.assertEqual(out['code'],'invalid-input')

    def test_canvas_corner_coordinates_map_to_backend_pixel_centers_without_half_pixel_shift(self):
        body=self.body();body['operation']='markup';body['options']={'strokes':[{'points':[{'x':.5,'y':1.5}],'color':'#FF0000','width':1,'opacity':1}]}
        status,out=self.request(body);self.assertEqual(status,200,out)
        image=fixture.Image.open(fixture.io.BytesIO(base64.b64decode(out['image']['png'].split(',')[1]))).convert('RGBA')
        # Twelve of sixteen independent 4x4 samples lie inside this half-radius circle.
        self.assertEqual(image.getpixel((0,1)),(194,5,8,255))
        self.assertEqual(image.getpixel((1,2)),(10,20,30,255))
        self.assertEqual(out['metadata']['parameters']['coordinateOffset'],-.5)

    def test_all_four_canvas_edges_clip_without_shift_or_rejection(self):
        for x,y,pixel in [(0,0,(0,0)),(2,0,(1,0)),(0,3,(0,2)),(2,3,(1,2))]:
            body=self.body();body['operation']='markup';body['options']={'strokes':[{'points':[{'x':x,'y':y}],'color':'#FF0000','width':1,'opacity':1}]}
            status,out=self.request(body);self.assertEqual(status,200,out)
            image=fixture.Image.open(fixture.io.BytesIO(base64.b64decode(out['image']['png'].split(',')[1]))).convert('RGBA')
            self.assertEqual(image.getpixel(pixel),(56,16,24,255))

    def test_opacity_zero_is_reported_as_no_change_not_fake_completion(self):
        body=self.body();body['operation']='markup';body['options']={'strokes':[{'points':[{'x':.5,'y':1.5}],'color':'#FF0000','width':1,'opacity':0}]}
        status,out=self.request(body);self.assertEqual(status,422);self.assertEqual(out['code'],'no-change');self.assertFalse(out['ok'])


if __name__=='__main__':unittest.main()

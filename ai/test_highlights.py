import unittest
import numpy as np
from highlights import rank_moments


class PeakSelectionTests(unittest.TestCase):
    def test_uniform_activity_does_not_fill_a_requested_count(self):
        motion = np.full(180, .03)
        scenes = np.zeros(180)
        audio = np.full(180, .3)
        result = rank_moments(motion, scenes, audio, [], 180, 30, 200)
        self.assertEqual(result["highlights"], [])

    def test_loud_audio_without_visual_or_speech_evidence_has_no_candidates(self):
        motion = np.zeros(180)
        scenes = np.zeros(180)
        audio = np.zeros(180)
        audio[60:70] = 1
        result = rank_moments(motion, scenes, audio, [], 180, 60, 200)
        self.assertEqual(result["highlights"], [])

    def test_selects_actual_bursts_and_adapts_their_boundaries(self):
        motion = np.full(180, .002)
        scenes = np.zeros(180)
        audio = np.full(180, .01)
        motion[25:30] = .12
        motion[105:120] = .15
        audio[25:30] = .4
        audio[105:120] = .5
        scenes[26] = .8
        scenes[107] = .8
        result = rank_moments(motion, scenes, audio, [], 180, 60, 200)
        self.assertEqual(len(result["highlights"]), 2)
        highlights = sorted(result["highlights"], key=lambda item: item["start"])
        self.assertTrue(24 <= highlights[0]["eventTime"] <= 31)
        self.assertTrue(104 <= highlights[1]["eventTime"] <= 121)
        self.assertNotEqual(highlights[0]["end"] - highlights[0]["start"], highlights[1]["end"] - highlights[1]["start"])
        self.assertLess(highlights[0]["end"], highlights[1]["start"])
        self.assertTrue(all(item["prominence"] >= .09 for item in highlights))


if __name__ == '__main__':
    unittest.main()
